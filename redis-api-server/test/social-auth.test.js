const test = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const socialAuth = require('../src/services/social-auth');
const {
  clearPortfolioModuleCache,
  createMemoryDdb,
  installFakeAws,
  setMcpTestEnv
} = require('./mcp-test-utils');

test('normalizes twitter alias to x provider', () => {
  assert.equal(socialAuth.normalizeProviderId('twitter'), 'x');
});

test('builds x provider config with current X OAuth endpoints', () => {
  const config = socialAuth.getProviderConfig('x');
  assert.equal(config.id, 'x');
  assert.equal(config.family, 'x');
  assert.equal(config.authUrl, 'https://x.com/i/oauth2/authorize');
  assert.equal(config.tokenUrl, 'https://api.x.com/2/oauth2/token');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/x/callback');
  assert.deepEqual(config.scopes, ['tweet.read', 'tweet.write', 'users.read', 'dm.read', 'dm.write', 'offline.access']);
  assert.equal(config.pkce, true);
});

test('builds X OAuth authorize URLs with percent-encoded scope separators', async (t) => {
  const previousClientId = process.env.SOCIAL_X_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_X_CLIENT_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    if (previousClientId === undefined) delete process.env.SOCIAL_X_CLIENT_ID;
    else process.env.SOCIAL_X_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_X_CLIENT_SECRET;
    else process.env.SOCIAL_X_CLIENT_SECRET = previousClientSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  process.env.SOCIAL_X_CLIENT_ID = 'x-client-id';
  process.env.SOCIAL_X_CLIENT_SECRET = 'x-client-secret';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');

  const result = await freshSocialAuth.startOAuth('x', {
    sub: 'author-sub',
    username: 'author'
  }, {
    returnUrl: 'https://author.grayson-wills.com/distribution'
  });

  const url = new URL(result.authUrl);
  assert.equal(`${url.origin}${url.pathname}`, 'https://x.com/i/oauth2/authorize');
  assert.match(result.authUrl, /scope=tweet\.read%20tweet\.write%20users\.read%20dm\.read%20dm\.write%20offline\.access/);
  assert.doesNotMatch(result.authUrl, /scope=[^&]*\+/);
  assert.equal(url.searchParams.get('scope'), 'tweet.read tweet.write users.read dm.read dm.write offline.access');
});

test('marks existing X connections as needing reconnect when newly required scopes are missing', async (t) => {
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');
  const user = {
    sub: 'author-sub',
    username: 'author'
  };

  await memory.ddb.send(new PutCommand({
    TableName: process.env.SOCIAL_AUTH_TABLE_NAME,
    Item: {
      pk: 'USER#author-sub',
      sk: 'PROVIDER#x',
      provider: 'x',
      providerFamily: 'x',
      username: 'author',
      accountLabel: '@author',
      scope: 'tweet.write users.read tweet.read offline.access',
      connectedAt: '2026-06-22T23:33:06.659Z',
      updatedAt: '2026-06-22T23:33:06.659Z',
      expiresAtMs: Date.now() + 3600_000,
      selectedAccount: {
        id: '123',
        label: '@author',
        handle: '@author',
        platform: 'x'
      }
    }
  }));

  const statuses = await freshSocialAuth.getProviderStatus(user);
  const xStatus = statuses.find((status) => status.provider === 'x');
  assert.equal(xStatus.status, 'needs-reconnect');
  assert.equal(xStatus.connected, false);
  assert.equal(xStatus.needsReconnect, true);
  assert.deepEqual(xStatus.missingScopes, ['dm.read', 'dm.write']);
});

test('builds provider config with production callback by default', () => {
  const config = socialAuth.getProviderConfig('linkedin');
  assert.equal(config.id, 'linkedin');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/linkedin/callback');
  assert.ok(config.scopes.includes('w_member_social'));
});

test('builds threads provider config with Threads OAuth endpoints', () => {
  const config = socialAuth.getProviderConfig('threads');
  assert.equal(config.id, 'threads');
  assert.equal(config.family, 'threads');
  assert.equal(config.authUrl, 'https://threads.net/oauth/authorize');
  assert.equal(config.tokenUrl, 'https://graph.threads.net/oauth/access_token');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/threads/callback');
  assert.deepEqual(config.scopes, ['threads_basic', 'threads_content_publish']);
});

test('builds instagram provider config with direct Instagram Login endpoints', () => {
  const config = socialAuth.getProviderConfig('instagram');
  assert.equal(config.id, 'instagram');
  assert.equal(config.family, 'instagram');
  assert.equal(config.authUrl, 'https://www.instagram.com/oauth/authorize');
  assert.equal(config.tokenUrl, 'https://api.instagram.com/oauth/access_token');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/instagram/callback');
  assert.deepEqual(config.scopes, [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
    'instagram_business_content_publish',
    'instagram_business_manage_insights'
  ]);
  assert.equal(config.scopeSeparator, ',');
  assert.equal(config.forceReauth, true);
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

test('reads Meta Login configuration id when configured', () => {
  const previousClientId = process.env.SOCIAL_META_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_META_CLIENT_SECRET;
  const previousConfigId = process.env.SOCIAL_FACEBOOK_CONFIG_ID;
  process.env.SOCIAL_META_CLIENT_ID = 'meta-client';
  process.env.SOCIAL_META_CLIENT_SECRET = 'meta-secret';
  process.env.SOCIAL_FACEBOOK_CONFIG_ID = 'fb-login-config';

  try {
    const config = socialAuth.getProviderConfig('facebook');
    assert.equal(config.configId, 'fb-login-config');
  } finally {
    if (previousClientId === undefined) delete process.env.SOCIAL_META_CLIENT_ID;
    else process.env.SOCIAL_META_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_META_CLIENT_SECRET;
    else process.env.SOCIAL_META_CLIENT_SECRET = previousClientSecret;
    if (previousConfigId === undefined) delete process.env.SOCIAL_FACEBOOK_CONFIG_ID;
    else process.env.SOCIAL_FACEBOOK_CONFIG_ID = previousConfigId;
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

test('imports Instagram access tokens as encrypted selected creator credentials', async (t) => {
  const originalFetch = global.fetch;
  const previousTokenSecret = process.env.SOCIAL_AUTH_TOKEN_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    global.fetch = originalFetch;
    if (previousTokenSecret === undefined) delete process.env.SOCIAL_AUTH_TOKEN_SECRET;
    else process.env.SOCIAL_AUTH_TOKEN_SECRET = previousTokenSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  process.env.SOCIAL_AUTH_TOKEN_SECRET = 'test-social-token-secret-32-chars-minimum';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/refresh_access_token')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          access_token: 'refreshed-instagram-token',
          token_type: 'bearer',
          expires_in: 5_184_000
        })
      };
    }

    return {
      ok: true,
      text: async () => JSON.stringify({
        id: '27009032972102562',
        user_id: '17841439874314506',
        username: 'grayson_willss',
        name: 'Grayson Wills',
        account_type: 'MEDIA_CREATOR',
        profile_picture_url: 'https://example.test/profile.jpg'
      })
    };
  };

  const result = await freshSocialAuth.importProviderToken('instagram', {
    sub: 'author-sub',
    username: 'author'
  }, {
    accessToken: 'original-instagram-access-token'
  });

  assert.equal(result.provider, 'instagram');
  assert.equal(result.selectedAccount.id, '17841439874314506');
  assert.equal(result.selectedAccount.handle, '@grayson_willss');
  assert.equal(result.refreshed, true);

  const stored = memory.valuesForTable('social-auth-test');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].providerFamily, 'instagram');
  assert.equal(stored[0].connectionMethod, 'token-import');
  assert.equal(stored[0].selectedAccount.extra.accountType, 'MEDIA_CREATOR');
  assert.equal(JSON.stringify(stored[0]).includes('original-instagram-access-token'), false);
  assert.equal(JSON.stringify(stored[0]).includes('refreshed-instagram-token'), false);
});
