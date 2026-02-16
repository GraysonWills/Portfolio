const crypto = require('crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function base64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function maskEmail(email) {
  const e = normalizeEmail(email);
  const [user, domain] = e.split('@');
  if (!user || !domain) return '***';
  const safeUser = user.length <= 2 ? `${user[0] || '*'}*` : `${user[0]}***${user[user.length - 1]}`;
  const domainParts = domain.split('.');
  const safeDomain = domainParts.length >= 2
    ? `${domainParts[0]?.[0] || '*'}***.${domainParts.slice(1).join('.')}`
    : `${domain[0] || '*'}***`;
  return `${safeUser}@${safeDomain}`;
}

module.exports = {
  sha256Hex,
  randomToken,
  normalizeEmail,
  maskEmail,
};

