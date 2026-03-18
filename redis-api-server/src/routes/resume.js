const express = require('express');
const requirePublicEdgeAccess = require('../middleware/requirePublicEdgeAccess');

const router = express.Router();

function getResumeUrl() {
  const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, '');
  return `${publicSiteUrl}/assets/Grayson_Wills_Resume.docx`;
}

router.get('/download', requirePublicEdgeAccess, (req, res) => {
  const resumeUrl = getResumeUrl();
  res.set('Cache-Control', 'no-store, max-age=0');
  return res.redirect(302, resumeUrl);
});

module.exports = router;
