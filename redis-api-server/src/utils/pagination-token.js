const crypto = require('crypto');

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortObject(value[key]);
  }
  return out;
}

function computeFilterHash(filterPayload) {
  const normalized = JSON.stringify(sortObject(filterPayload || {}));
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function encodeOffsetToken({ offset, sort, filterHash }) {
  const payload = {
    mode: 'offset',
    offset: Math.max(0, Number(offset) || 0),
    sort: String(sort || 'updated_desc'),
    filterHash: String(filterHash || '')
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function tryDecode(raw, encoding) {
  try {
    const decoded = Buffer.from(raw, encoding).toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function decodeOffsetToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;

  const parsed = tryDecode(raw, 'base64url') || tryDecode(raw, 'base64');
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Malformed nextToken payload');
  }

  if (parsed.mode !== 'offset') {
    throw new Error('Unsupported nextToken mode');
  }

  const offset = Number(parsed.offset);
  if (!Number.isFinite(offset) || offset < 0) {
    throw new Error('Invalid nextToken offset');
  }

  return {
    mode: 'offset',
    offset: Math.floor(offset),
    sort: String(parsed.sort || 'updated_desc'),
    filterHash: String(parsed.filterHash || '')
  };
}

module.exports = {
  computeFilterHash,
  encodeOffsetToken,
  decodeOffsetToken
};
