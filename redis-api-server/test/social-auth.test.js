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

test('summarizes token payload without exposing raw token values', () => {
  const summary = socialAuth.summarizeTokenPayload({
    access_token: 'secret-access',
    refresh_token: 'secret-refresh',
    id_token: 'secret-id',
    token_type: 'bearer',
    expires_in: 3600,
    scope: 'tweet.read tweet.write',
    extra_field: 'ok'
  }, socialAuth.getProviderConfig('x'));

  assert.equal(summary.hasAccessToken, true);
  assert.equal(summary.hasRefreshToken, true);
  assert.equal(summary.hasIdToken, true);
  assert.equal(summary.expiresInSeconds, 3600);
  assert.equal(summary.scope, 'tweet.read tweet.write');
  assert.deepEqual(summary.providerFields, ['expires_in', 'extra_field', 'scope', 'token_type']);
  assert.equal(JSON.stringify(summary).includes('secret-access'), false);
  assert.equal(JSON.stringify(summary).includes('secret-refresh'), false);
});

test('builds OAuth error return URL with sanitized provider status', async () => {
  const url = await socialAuth.buildOAuthReturnUrl('linkedin', {
    status: 'error',
    error: 'access_denied'
  });
  const parsed = new URL(url);

  assert.equal(`${parsed.protocol}//${parsed.host}${parsed.pathname}`, 'https://author.grayson-wills.com/distribution');
  assert.equal(parsed.searchParams.get('socialProvider'), 'linkedin');
  assert.equal(parsed.searchParams.get('socialStatus'), 'error');
  assert.equal(parsed.searchParams.get('socialError'), 'access_denied');
});
