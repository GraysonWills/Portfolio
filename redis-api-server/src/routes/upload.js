/**
 * Upload Routes
 * Handles image uploads
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const redisClient = require('../config/redis');

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
 * Upload an image and return base64 data URL
 */
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Convert to base64
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;
    
    // Optionally store in Redis with an ID for later retrieval
    const imageId = uuidv4();
    const imageKey = `image:${imageId}`;
    await redisClient.set(imageKey, dataUrl);
    await redisClient.expire(imageKey, 3600 * 24 * 7); // 7 days expiry
    
    res.json({
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
