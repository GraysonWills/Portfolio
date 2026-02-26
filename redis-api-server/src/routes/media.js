/**
 * Public media proxy.
 *
 * Serves S3 media objects by key for environments where the bucket is private
 * and a CDN base URL is not configured.
 */

const express = require('express');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getMediaConfig } = require('../utils/media-url');

const router = express.Router();

let s3Client = null;
let s3Region = '';

function getS3Client(region) {
  if (s3Client && s3Region === region) return s3Client;
  s3Client = new S3Client({ region });
  s3Region = region;
  return s3Client;
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    body.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    body.on('error', reject);
    body.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

router.get('/:key(*)', async (req, res) => {
  try {
    const cfg = getMediaConfig();
    if (!cfg.bucket) {
      return res.status(503).json({ error: 'Media bucket is not configured.' });
    }

    const key = String(req.params.key || '').trim();
    if (!key || key.includes('..')) {
      return res.status(400).json({ error: 'Invalid media key.' });
    }

    const result = await getS3Client(cfg.region).send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key
      })
    );

    const payload = await bodyToBuffer(result.Body);
    res.set('Cache-Control', 'public,max-age=31536000,immutable');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Content-Type', result.ContentType || 'application/octet-stream');
    if (Number.isFinite(result.ContentLength)) {
      res.set('Content-Length', String(result.ContentLength));
    }
    if (result.ETag) {
      res.set('ETag', String(result.ETag));
    }
    if (result.LastModified) {
      res.set('Last-Modified', new Date(result.LastModified).toUTCString());
    }

    return res.send(payload);
  } catch (error) {
    const code = String(error?.name || '').toLowerCase();
    if (code.includes('nosuchkey') || code.includes('notfound')) {
      return res.status(404).json({ error: 'Media object not found.' });
    }
    return res.status(500).json({ error: error.message || 'Failed to load media object.' });
  }
});

module.exports = router;
