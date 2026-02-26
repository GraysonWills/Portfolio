/**
 * Upload Routes
 * Handles image uploads
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const requireAuth = require('../middleware/requireAuth');
const path = require('path');
const {
  isPhotoAssetsEnabled,
  createPendingPhotoAsset,
  markPhotoAssetReady,
  markPhotoAssetDeleted
} = require('../services/photo-assets-ddb');
const { buildPublicMediaUrlForKey, encodeS3PathSegments } = require('../utils/media-url');

let s3Client = null;
let PutObjectCommand = null;
let DeleteObjectCommand = null;
try {
  // Lazy require: local dev can run without AWS SDK installed.
  ({ S3Client: s3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3'));
} catch {
  // ignore
}

function getS3() {
  const bucket = process.env.PHOTO_ASSETS_BUCKET || process.env.S3_UPLOAD_BUCKET;
  if (!bucket) return null;
  if (!s3Client || !PutObjectCommand) return null;
  const region = process.env.PHOTO_ASSETS_REGION || process.env.S3_UPLOAD_REGION || process.env.AWS_REGION || 'us-east-2';
  return {
    client: new s3Client({ region }),
    bucket,
    region,
    prefix: (process.env.PHOTO_ASSETS_PREFIX || process.env.S3_UPLOAD_PREFIX || 'uploads/')
      .replace(/^\/+/, '')
      .replace(/\/?$/, '/'),
    cdnBaseUrl: String(process.env.PHOTO_ASSETS_CDN_BASE_URL || '').trim().replace(/\/+$/, ''),
  };
}

function getOwnerFromRequest(req) {
  const raw = req?.user?.['cognito:username'] || req?.user?.username || req?.user?.sub || '';
  return String(raw || 'unknown').trim().toLowerCase() || 'unknown';
}

function toPublicUrl(s3, key, req) {
  if (s3.cdnBaseUrl) {
    return `${s3.cdnBaseUrl}/${encodeS3PathSegments(key)}`;
  }
  return buildPublicMediaUrlForKey(req, key, {
    bucket: s3.bucket,
    region: s3.region,
    cdnBaseUrl: ''
  });
}

// Configure multer for memory storage.
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

/**
 * POST /api/upload/image
 * Upload an image.
 *
 * If S3 is configured via env vars (S3_UPLOAD_BUCKET), the image is uploaded
 * to S3 and a public URL is returned.
 */
router.post('/image', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const s3 = getS3();
    if (s3) {
      const ext = (path.extname(req.file.originalname || '') || '').toLowerCase();
      const safeExt = ext && ext.length <= 10 ? ext : '';
      const fileBaseName = path.basename(String(req.file.originalname || ''), ext)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'image';

      const metadataEnabled = isPhotoAssetsEnabled();
      const assetId = metadataEnabled ? `asset-${uuidv4()}` : '';
      const now = new Date();
      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');

      const objectKey = metadataEnabled
        ? `${s3.prefix}${yyyy}/${mm}/${dd}/${assetId}/${fileBaseName}${safeExt}`
        : `${s3.prefix}${uuidv4()}${safeExt}`;
      const publicUrl = toPublicUrl(s3, objectKey, req);
      const owner = getOwnerFromRequest(req);

      if (metadataEnabled) {
        await createPendingPhotoAsset({
          asset_id: assetId,
          owner,
          status: 'pending',
          storage_bucket: s3.bucket,
          storage_key: objectKey,
          public_url: publicUrl,
          original_filename: `${fileBaseName}${safeExt}`,
          content_type: req.file.mimetype,
          size_bytes: req.file.size,
          usage: 'legacy-upload',
          tags: [],
          metadata: {
            source: 'upload.image'
          },
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        });
      }

      let putResult = null;
      try {
        const cmd = new PutObjectCommand({
          Bucket: s3.bucket,
          Key: objectKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
          CacheControl: 'public,max-age=31536000,immutable'
        });
        putResult = await s3.client.send(cmd);

        if (metadataEnabled) {
          await markPhotoAssetReady(assetId, {
            ready_at: new Date().toISOString(),
            public_url: publicUrl,
            content_type: req.file.mimetype,
            size_bytes: req.file.size,
            e_tag: String(putResult?.ETag || '').replace(/^"+|"+$/g, '')
          });
        }
      } catch (error) {
        if (metadataEnabled) {
          try {
            if (DeleteObjectCommand) {
              await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: objectKey }));
            }
            await markPhotoAssetDeleted(assetId, { hard_deleted: true });
          } catch {
            // ignore cleanup failures
          }
        }
        throw error;
      }

      return res.json({
        url: publicUrl,
        key: objectKey,
        bucket: s3.bucket,
        mimetype: req.file.mimetype,
        size: req.file.size,
        ...(metadataEnabled ? { assetId } : {})
      });
    }

    return res.status(503).json({
      error: 'Image upload storage is not configured. Set S3_UPLOAD_BUCKET and S3_UPLOAD_REGION.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
