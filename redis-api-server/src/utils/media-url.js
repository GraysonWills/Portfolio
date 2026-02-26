/**
 * Public media URL helpers.
 *
 * Supports three delivery modes for S3-backed image URLs:
 * 1) CDN URL when PHOTO_ASSETS_CDN_BASE_URL is configured.
 * 2) API proxy URL (/media/:key) when CDN is not configured.
 * 3) Original URL passthrough for non-target URLs.
 */

function getMediaConfig() {
  const bucket = String(process.env.PHOTO_ASSETS_BUCKET || process.env.S3_UPLOAD_BUCKET || '').trim();
  const region = String(process.env.PHOTO_ASSETS_REGION || process.env.S3_UPLOAD_REGION || process.env.AWS_REGION || 'us-east-2').trim();
  const cdnBaseUrl = String(process.env.PHOTO_ASSETS_CDN_BASE_URL || '').trim().replace(/\/+$/, '');
  return { bucket, region, cdnBaseUrl };
}

function encodeS3PathSegments(key) {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeS3PathSegments(key) {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function getRequestOrigin(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'https')
    .split(',')[0]
    .trim()
    .toLowerCase() || 'https';
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '')
    .split(',')[0]
    .trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

function buildPublicMediaUrlForKey(req, key, cfg = getMediaConfig()) {
  const safeKey = decodeS3PathSegments(String(key || '').replace(/^\/+/, ''));
  if (!safeKey) return '';

  if (cfg.cdnBaseUrl) {
    return `${cfg.cdnBaseUrl}/${encodeS3PathSegments(safeKey)}`;
  }

  const origin = getRequestOrigin(req);
  if (!origin) return '';
  return `${origin}/media/${encodeS3PathSegments(safeKey)}`;
}

function parseS3ObjectKeyFromUrl(rawUrl, cfg = getMediaConfig()) {
  const bucket = String(cfg.bucket || '').trim().toLowerCase();
  if (!bucket) return '';

  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    return '';
  }

  const host = String(parsed.hostname || '').trim().toLowerCase();
  const path = String(parsed.pathname || '').replace(/^\/+/, '');

  const bucketVirtualHostPattern = new RegExp(`^${bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com$`, 'i');
  if (bucketVirtualHostPattern.test(host)) {
    return decodeS3PathSegments(path);
  }

  const pathHostPattern = /^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i;
  if (!pathHostPattern.test(host)) {
    return '';
  }

  const [first, ...rest] = path.split('/');
  if (String(first || '').toLowerCase() !== bucket) {
    return '';
  }
  return decodeS3PathSegments(rest.join('/'));
}

function rewritePublicAssetUrl(rawUrl, req, cfg = getMediaConfig()) {
  const input = String(rawUrl || '').trim();
  if (!input) return input;

  // Already on configured CDN base URL.
  if (cfg.cdnBaseUrl && input.startsWith(`${cfg.cdnBaseUrl}/`)) {
    return input;
  }

  const key = parseS3ObjectKeyFromUrl(input, cfg);
  if (!key) return input;

  const publicUrl = buildPublicMediaUrlForKey(req, key, cfg);
  return publicUrl || input;
}

function rewriteDeepAssetUrls(value, req, cfg = getMediaConfig(), depth = 0) {
  if (depth > 8) return value;
  if (typeof value === 'string') return rewritePublicAssetUrl(value, req, cfg);
  if (Array.isArray(value)) return value.map((item) => rewriteDeepAssetUrls(item, req, cfg, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = rewriteDeepAssetUrls(v, req, cfg, depth + 1);
  }
  return out;
}

function rewriteContentItemMediaUrls(item, req, cfg = getMediaConfig()) {
  if (!item || typeof item !== 'object') return item;

  const next = { ...item };

  if (typeof next.Photo === 'string') {
    next.Photo = rewritePublicAssetUrl(next.Photo, req, cfg);
  }

  if (next.Metadata && typeof next.Metadata === 'object') {
    next.Metadata = rewriteDeepAssetUrls(next.Metadata, req, cfg);
  }

  // BlogBody blocks are stored as JSON text; normalize image/carousel URLs there as well.
  if (typeof next.Text === 'string' && Number(next.PageContentID) === 13) {
    const raw = next.Text.trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const blocks = JSON.parse(next.Text);
        const rewritten = rewriteDeepAssetUrls(blocks, req, cfg);
        next.Text = JSON.stringify(rewritten);
      } catch {
        // Keep original text if parsing fails.
      }
    }
  }

  return next;
}

module.exports = {
  getMediaConfig,
  encodeS3PathSegments,
  decodeS3PathSegments,
  getRequestOrigin,
  buildPublicMediaUrlForKey,
  parseS3ObjectKeyFromUrl,
  rewritePublicAssetUrl,
  rewriteDeepAssetUrls,
  rewriteContentItemMediaUrls,
};
