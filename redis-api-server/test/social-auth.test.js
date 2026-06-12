const test = require('node:test');
const assert = require('node:assert/strict');

const socialAuth = require('../src/services/social-auth');

test('normalizes twitter alias to x provider', () => {
  assert.equal(socialAuth.normalizeProviderId('twitter'), 'x');
});

test('builds provider config with production callback by default', () => {
  const config = socialAuth.getProviderConfig('linkedin');
  assert.equal(config.id, 'linkedin');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/linkedin/callback');
  assert.ok(config.scopes.includes('w_member_social'));
});

test('uses configured social auth redirect base URL', () => {
  const prev = process.env.SOCIAL_AUTH_REDIRECT_BASE_URL;
  process.env.SOCIAL_AUTH_REDIRECT_BASE_URL = 'https://example.test/api/social-auth/';
  try {
    const config = socialAuth.getProviderConfig('instagram');
    assert.equal(config.redirectUri, 'https://example.test/api/social-auth/instagram/callback');
  } finally {
    if (prev === undefined) delete process.env.SOCIAL_AUTH_REDIRECT_BASE_URL;
    else process.env.SOCIAL_AUTH_REDIRECT_BASE_URL = prev;
  }
});

test('rejects untrusted OAuth return URLs', () => {
  const normalized = socialAuth.normalizeReturnUrl('https://attacker.example/distribution');
  assert.equal(normalized, 'https://author.grayson-wills.com/distribution');
});

test('allows authoring return URLs', () => {
  const normalized = socialAuth.normalizeReturnUrl('https://author.grayson-wills.com/distribution?draft=1');
  assert.equal(normalized, 'https://author.grayson-wills.com/distribution?draft=1');
});
