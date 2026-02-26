/**
 * Photo Assets Routes
 *
 * Architecture:
 * - Binary file storage in S3
 * - Asset metadata/indexing in DynamoDB
 * - Signed upload URLs keep large file transfer off the API service path
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const requireAuth = require('../middleware/requireAuth');
const { getAwsRegion } = require('../services/aws/clients');
const { buildPublicMediaUrlForKey, encodeS3PathSegments } = require('../utils/media-url');
const {
  isPhotoAssetsEnabled,
  createPendingPhotoAsset,
  getPhotoAssetById,
  listPhotoAssets,
  markPhotoAssetReady,
  markPhotoAssetDeleted,
  deletePhotoAssetRecord,
} = require('../services/photo-assets-ddb');

const router = express.Router();

const DEFAULT_ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
];

let s3Client = null;
let s3Region = '';

function clampInt(value, min, max, fallback) {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getConfig() {
  const region = String(
    process.env.PHOTO_ASSETS_REGION
      || process.env.S3_UPLOAD_REGION
      || process.env.AWS_REGION
      || getAwsRegion()
  ).trim();
  const bucket = String(process.env.PHOTO_ASSETS_BUCKET || process.env.S3_UPLOAD_BUCKET || '').trim();
  return {
    region,
    bucket,
    prefix: String(process.env.PHOTO_ASSETS_PREFIX || 'photo-assets/').replace(/^\/+/, '').replace(/\/?$/, '/'),
    cdnBaseUrl: String(process.env.PHOTO_ASSETS_CDN_BASE_URL || '').trim().replace(/\/+$/, ''),
    maxFileBytes: clampInt(process.env.PHOTO_ASSETS_MAX_FILE_BYTES, 256 * 1024, 50 * 1024 * 1024, 15 * 1024 * 1024),
    presignExpiresSeconds: clampInt(process.env.PHOTO_ASSETS_PRESIGN_EXPIRES_SECONDS, 60, 3600, 900),
    allowedMime: String(process.env.PHOTO_ASSETS_ALLOWED_MIME || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

function getS3Client(region) {
  if (s3Client && s3Region === region) return s3Client;
  s3Client = new S3Client({ region });
  s3Region = region;
  return s3Client;
}

function getOwnerFromRequest(req) {
  const raw = req?.user?.['cognito:username'] || req?.user?.username || req?.user?.sub || '';
  return String(raw || 'unknown').trim().toLowerCase() || 'unknown';
}

function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => String(t || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

function toSafeFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const base = path.basename(String(filename || ''), ext).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-');
  const safeBase = base.replace(/^-+|-+$/g, '').slice(0, 80) || 'image';
  const safeExt = ext && ext.length <= 10 ? ext : '';
  return `${safeBase}${safeExt}`;
}

function toPublicUrl(cfg, key, req) {
  if (cfg.cdnBaseUrl) {
    return `${cfg.cdnBaseUrl}/${encodeS3PathSegments(key)}`;
  }
  return buildPublicMediaUrlForKey(req, key, {
    bucket: cfg.bucket,
    region: cfg.region,
    cdnBaseUrl: ''
  });
}

function isAllowedMime(contentType, cfg) {
  const normalized = String(contentType || '').trim().toLowerCase();
  if (!normalized) return false;
  const allowed = cfg.allowedMime.length ? cfg.allowedMime : DEFAULT_ALLOWED_MIME;
  return allowed.includes(normalized);
}

function requireConfigured() {
  const cfg = getConfig();
  if (!cfg.bucket) throw new Error('PHOTO_ASSETS_BUCKET (or S3_UPLOAD_BUCKET) is not set');
  if (!isPhotoAssetsEnabled()) throw new Error('PHOTO_ASSETS_TABLE_NAME is not set');
  return cfg;
}

function canAccessAsset(req, asset) {
  const owner = getOwnerFromRequest(req);
  const isAdmin = Boolean(req?.user?.['cognito:groups']?.includes?.('admin'));
  return isAdmin || owner === String(asset?.owner || '').trim().toLowerCase();
}

router.post('/upload-url', requireAuth, async (req, res) => {
  try {
    const cfg = requireConfigured();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const filename = toSafeFilename(body.filename || body.originalFilename || '');
    const contentType = String(body.contentType || '').trim().toLowerCase();
    const sizeBytes = clampInt(body.sizeBytes, 1, cfg.maxFileBytes, 0);
    const usage = String(body.usage || 'general').trim().toLowerCase().slice(0, 40);
    const checksumSha256 = String(body.checksumSha256 || '').trim().toLowerCase();
    const tags = normalizeTags(body.tags);
    const owner = getOwnerFromRequest(req);

    if (!isAllowedMime(contentType, cfg)) {
      return res.status(400).json({ error: 'Unsupported image contentType.' });
    }
    if (!sizeBytes) {
      return res.status(400).json({ error: 'sizeBytes is required.' });
    }
    if (sizeBytes > cfg.maxFileBytes) {
      return res.status(400).json({ error: `File too large. Max is ${cfg.maxFileBytes} bytes.` });
    }
    if (checksumSha256 && !/^[a-f0-9]{64}$/.test(checksumSha256)) {
      return res.status(400).json({ error: 'checksumSha256 must be a 64-char lowercase hex string.' });
    }

    const assetId = `asset-${uuidv4()}`;
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const objectKey = `${cfg.prefix}${yyyy}/${mm}/${dd}/${assetId}/${filename}`;
    const publicUrl = toPublicUrl(cfg, objectKey, req);
    const createdAt = now.toISOString();

    const metadata = {
      source_ip_hash: crypto.createHash('sha256').update(String(req.ip || '')).digest('hex'),
    };

    await createPendingPhotoAsset({
      asset_id: assetId,
      owner,
      status: 'pending',
      storage_bucket: cfg.bucket,
      storage_key: objectKey,
      public_url: publicUrl,
      original_filename: filename,
      content_type: contentType,
      size_bytes: sizeBytes,
      checksum_sha256: checksumSha256,
      usage,
      tags,
      alt_text: String(body.altText || '').trim().slice(0, 240),
      caption: String(body.caption || '').trim().slice(0, 1000),
      metadata,
      created_at: createdAt,
      updated_at: createdAt,
    });

    const uploadCommand = new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      ContentType: contentType,
      CacheControl: 'public,max-age=31536000,immutable',
    });

    const uploadUrl = await getSignedUrl(
      getS3Client(cfg.region),
      uploadCommand,
      { expiresIn: cfg.presignExpiresSeconds }
    );

    return res.status(201).json({
      assetId,
      uploadUrl,
      uploadMethod: 'PUT',
      uploadHeaders: { 'Content-Type': contentType },
      expiresInSeconds: cfg.presignExpiresSeconds,
      publicUrl,
      bucket: cfg.bucket,
      key: objectKey,
      status: 'pending',
    });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

router.post('/:assetId/complete', requireAuth, async (req, res) => {
  try {
    const cfg = requireConfigured();
    const assetId = String(req.params.assetId || '').trim();
    if (!assetId) return res.status(400).json({ error: 'assetId is required.' });

    const current = await getPhotoAssetById(assetId);
    if (!current) return res.status(404).json({ error: 'Asset not found.' });
    if (!canAccessAsset(req, current)) return res.status(403).json({ error: 'Forbidden' });

    const head = await getS3Client(cfg.region).send(new HeadObjectCommand({
      Bucket: current.storage_bucket || cfg.bucket,
      Key: current.storage_key,
    }));

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const width = Number.isFinite(Number(body.width)) ? Math.max(1, Math.min(10000, Number(body.width))) : undefined;
    const height = Number.isFinite(Number(body.height)) ? Math.max(1, Math.min(10000, Number(body.height))) : undefined;
    const tags = Array.isArray(body.tags) ? normalizeTags(body.tags) : undefined;

    const updated = await markPhotoAssetReady(assetId, {
      ready_at: new Date().toISOString(),
      public_url: current.public_url || toPublicUrl(cfg, current.storage_key, req),
      content_type: String(head.ContentType || current.content_type || '').trim().toLowerCase(),
      size_bytes: Number.isFinite(Number(head.ContentLength)) ? Number(head.ContentLength) : current.size_bytes,
      e_tag: String(head.ETag || '').replace(/^"+|"+$/g, ''),
      width,
      height,
      tags,
      alt_text: body.altText !== undefined ? String(body.altText || '').trim().slice(0, 240) : undefined,
      caption: body.caption !== undefined ? String(body.caption || '').trim().slice(0, 1000) : undefined,
      checksum_sha256: String(body.checksumSha256 || current.checksum_sha256 || '').trim().toLowerCase() || undefined,
    });

    return res.json({ ok: true, asset: updated || current });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    requireConfigured();
    const limit = clampInt(req.query.limit, 1, 100, 24);
    const nextToken = String(req.query.nextToken || '').trim();
    const status = String(req.query.status || '').trim().toLowerCase();
    const usage = String(req.query.usage || '').trim().toLowerCase();
    const mine = String(req.query.mine || 'true').trim().toLowerCase() !== 'false';
    const owner = mine ? getOwnerFromRequest(req) : String(req.query.owner || '').trim().toLowerCase();

    const out = await listPhotoAssets({ limit, nextToken, status, usage, owner });
    return res.json({
      items: out.items || [],
      nextToken: out.nextToken || null,
      count: Array.isArray(out.items) ? out.items.length : 0
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:assetId', requireAuth, async (req, res) => {
  try {
    requireConfigured();
    const assetId = String(req.params.assetId || '').trim();
    if (!assetId) return res.status(400).json({ error: 'assetId is required.' });
    const asset = await getPhotoAssetById(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (!canAccessAsset(req, asset)) return res.status(403).json({ error: 'Forbidden' });
    return res.json(asset);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:assetId', requireAuth, async (req, res) => {
  try {
    const cfg = requireConfigured();
    const assetId = String(req.params.assetId || '').trim();
    if (!assetId) return res.status(400).json({ error: 'assetId is required.' });

    const hardDelete = String(req.query.hard || 'false').trim().toLowerCase() === 'true';
    const purgeMetadata = String(req.query.purgeMetadata || 'false').trim().toLowerCase() === 'true';

    const asset = await getPhotoAssetById(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (!canAccessAsset(req, asset)) return res.status(403).json({ error: 'Forbidden' });

    if (hardDelete && asset.storage_key) {
      await getS3Client(cfg.region).send(new DeleteObjectCommand({
        Bucket: asset.storage_bucket || cfg.bucket,
        Key: asset.storage_key,
      }));
    }

    const updated = await markPhotoAssetDeleted(assetId, { hard_deleted: hardDelete });

    if (purgeMetadata) {
      await deletePhotoAssetRecord(assetId);
    }

    return res.json({
      ok: true,
      hardDelete,
      metadataPurged: purgeMetadata,
      asset: purgeMetadata ? null : (updated || asset)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
