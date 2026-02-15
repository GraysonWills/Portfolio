/**
 * Upload Routes
 * Handles image uploads
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const redisClient = require('../config/redis');
const requireAuth = require('../middleware/requireAuth');
const path = require('path');

let s3Client = null;
let PutObjectCommand = null;
try {
  // Lazy require: local dev can run without AWS SDK installed.
  ({ S3Client: s3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
} catch {
  // ignore
}

function getS3() {
  const bucket = process.env.S3_UPLOAD_BUCKET;
  if (!bucket) return null;
  if (!s3Client || !PutObjectCommand) return null;
  const region = process.env.S3_UPLOAD_REGION || process.env.AWS_REGION || 'us-east-2';
  return {
    client: new s3Client({ region }),
    bucket,
    region,
    prefix: (process.env.S3_UPLOAD_PREFIX || 'uploads/').replace(/^\/+/, '').replace(/\/?$/, '/')
  };
}

// Configure multer for memory storage (images stored as base64 in Redis)
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
 *
 * Otherwise, it falls back to base64 data URLs stored in Redis (7-day TTL).
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
      const objectKey = `${s3.prefix}${uuidv4()}${safeExt}`;

      const cmd = new PutObjectCommand({
        Bucket: s3.bucket,
        Key: objectKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        CacheControl: 'public,max-age=31536000,immutable'
      });

      await s3.client.send(cmd);

      const publicUrl = s3.region === 'us-east-1'
        ? `https://${s3.bucket}.s3.amazonaws.com/${objectKey}`
        : `https://${s3.bucket}.s3.${s3.region}.amazonaws.com/${objectKey}`;

      return res.json({
        url: publicUrl,
        key: objectKey,
        bucket: s3.bucket,
        mimetype: req.file.mimetype,
        size: req.file.size
      });
    }

    // Fallback: Convert to base64 and store in Redis (7 days)
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    const imageId = uuidv4();
    const imageKey = `image:${imageId}`;
    await redisClient.set(imageKey, dataUrl);
    await redisClient.expire(imageKey, 3600 * 24 * 7);

    return res.json({
      url: dataUrl,
      id: imageId,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
