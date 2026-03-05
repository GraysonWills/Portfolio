const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeFilterHash,
  encodeOffsetToken,
  decodeOffsetToken
} = require('../src/utils/pagination-token');

test('computeFilterHash is stable for object key order', () => {
  const a = computeFilterHash({ b: 2, a: 1, nested: { y: 2, x: 1 } });
  const b = computeFilterHash({ nested: { x: 1, y: 2 }, a: 1, b: 2 });
  assert.equal(a, b);
});

test('offset token round-trip encode/decode', () => {
  const token = encodeOffsetToken({
    offset: 60,
    sort: 'updated_desc',
    filterHash: 'abc123'
  });
  const decoded = decodeOffsetToken(token);
  assert.equal(decoded.mode, 'offset');
  assert.equal(decoded.offset, 60);
  assert.equal(decoded.sort, 'updated_desc');
  assert.equal(decoded.filterHash, 'abc123');
});

test('decodeOffsetToken rejects malformed token payload', () => {
  assert.throws(() => decodeOffsetToken('this-is-not-base64-json'));
});

