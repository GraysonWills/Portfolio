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

test('refreshes expired X access tokens before reporting status or posting credentials', async (t) => {
  const originalFetch = global.fetch;
  const previousClientId = process.env.SOCIAL_X_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_X_CLIENT_SECRET;
  const previousTokenSecret = process.env.SOCIAL_AUTH_TOKEN_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    global.fetch = originalFetch;
    if (previousClientId === undefined) delete process.env.SOCIAL_X_CLIENT_ID;
    else process.env.SOCIAL_X_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_X_CLIENT_SECRET;
    else process.env.SOCIAL_X_CLIENT_SECRET = previousClientSecret;
    if (previousTokenSecret === undefined) delete process.env.SOCIAL_AUTH_TOKEN_SECRET;
    else process.env.SOCIAL_AUTH_TOKEN_SECRET = previousTokenSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  process.env.SOCIAL_X_CLIENT_ID = 'x-client-id';
  process.env.SOCIAL_X_CLIENT_SECRET = 'x-client-secret';
  process.env.SOCIAL_AUTH_TOKEN_SECRET = 'test-social-token-secret-32-chars-minimum';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');
  const user = {
    sub: 'author-sub',
    username: 'author'
  };
  const tokenRequests = [];
  const expectedBasic = `Basic ${Buffer.from('x-client-id:x-client-secret').toString('base64')}`;

  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href === 'https://api.x.com/2/oauth2/token') {
      const params = new URLSearchParams(String(options.body || ''));
      tokenRequests.push({
        grantType: params.get('grant_type'),
        refreshToken: params.get('refresh_token'),
        authorization: options.headers?.Authorization || ''
      });
      assert.equal(options.headers?.Authorization, expectedBasic);

      if (params.get('grant_type') === 'authorization_code') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            access_token: 'old-x-access-token',
            refresh_token: 'old-x-refresh-token',
            token_type: 'bearer',
            expires_in: 3600,
            scope: 'tweet.read tweet.write users.read dm.read dm.write offline.access'
          })
        };
      }

      if (params.get('grant_type') === 'refresh_token') {
        assert.equal(params.get('client_id'), 'x-client-id');
        assert.equal(params.get('refresh_token'), 'old-x-refresh-token');
        return {
          ok: true,
          text: async () => JSON.stringify({
            access_token: 'new-x-access-token',
            refresh_token: 'new-x-refresh-token',
            token_type: 'bearer',
            expires_in: 7200,
            scope: 'tweet.read tweet.write users.read dm.read dm.write offline.access'
          })
        };
      }
    }

    if (href.startsWith('https://api.twitter.com/2/users/me')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: {
            id: '2030858381473525760',
            username: 'GraysonWil91957',
            name: 'Grayson Wills'
          }
        })
      };
    }

    throw new Error(`Unexpected fetch ${href}`);
  };

  const start = await freshSocialAuth.startOAuth('x', user, {
    returnUrl: 'https://author.grayson-wills.com/distribution'
  });
  const state = new URL(start.authUrl).searchParams.get('state');
  await freshSocialAuth.completeOAuth('x', {
    code: 'oauth-code',
    state
  });

  const stored = memory.valuesForTable('social-auth-test').find((item) => item.provider === 'x');
  await memory.ddb.send(new PutCommand({
    TableName: process.env.SOCIAL_AUTH_TABLE_NAME,
    Item: {
      ...stored,
      selectedToken: stored.token,
      expiresAtMs: Date.now() - 1000
    }
  }));

  const statuses = await freshSocialAuth.getProviderStatus(user);
  const xStatus = statuses.find((status) => status.provider === 'x');
  assert.equal(xStatus.status, 'connected');
  assert.equal(xStatus.connected, true);
  assert.equal(xStatus.credentialArtifacts.hasRefreshToken, true);
  assert.equal(xStatus.credentialArtifacts.expiresInSeconds, 7200);
  assert.ok(new Date(xStatus.expiresAt).getTime() > Date.now());

  const credential = await freshSocialAuth.getPostingCredential('x', user);
  assert.equal(credential.token.access_token, 'new-x-access-token');
  assert.equal(credential.token.refresh_token, 'new-x-refresh-token');
  assert.equal(credential.token.scope, 'tweet.read tweet.write users.read dm.read dm.write offline.access');
  assert.deepEqual(tokenRequests.map((request) => request.grantType), ['authorization_code', 'refresh_token']);

  const refreshed = memory.valuesForTable('social-auth-test').find((item) => item.provider === 'x');
  assert.equal(refreshed.credentialArtifacts.expiresInSeconds, 7200);
  assert.notDeepEqual(refreshed.selectedToken, stored.token);
  assert.equal(JSON.stringify(refreshed).includes('new-x-access-token'), false);
  assert.equal(JSON.stringify(refreshed).includes('new-x-refresh-token'), false);
});

test('builds LinkedIn provider config with profile and posting scopes', () => {
  const config = socialAuth.getProviderConfig('linkedin');
  assert.equal(config.id, 'linkedin');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/linkedin/callback');
  assert.deepEqual(config.scopes, ['openid', 'profile', 'email', 'r_profile_basicinfo', 'w_member_social']);
});

test('builds Google provider config with broad API scopes and offline OAuth params', () => {
  const config = socialAuth.getProviderConfig('google');
  assert.equal(config.id, 'google');
  assert.equal(config.family, 'google');
  assert.equal(config.authUrl, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(config.tokenUrl, 'https://oauth2.googleapis.com/token');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/google/callback');
  assert.equal(config.pkce, true);
  assert.deepEqual(config.authParams, {
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent'
  });
  assert.ok(config.scopes.includes('https://www.googleapis.com/auth/gmail.modify'));
  assert.ok(config.scopes.includes('https://www.googleapis.com/auth/youtube.upload'));
  assert.ok(config.scopes.includes('https://www.googleapis.com/auth/adwords'));
});

test('allows Google scopes to be narrowed from environment', () => {
  const previousScopes = process.env.SOCIAL_GOOGLE_SCOPES;
  process.env.SOCIAL_GOOGLE_SCOPES = 'openid email profile https://www.googleapis.com/auth/youtube.upload';

  try {
    const config = socialAuth.getProviderConfig('google');
    assert.deepEqual(config.scopes, [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/youtube.upload'
    ]);
  } finally {
    if (previousScopes === undefined) delete process.env.SOCIAL_GOOGLE_SCOPES;
    else process.env.SOCIAL_GOOGLE_SCOPES = previousScopes;
  }
});

test('builds Google OAuth authorize URLs with PKCE and offline consent', async (t) => {
  const previousClientId = process.env.SOCIAL_GOOGLE_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_GOOGLE_CLIENT_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    if (previousClientId === undefined) delete process.env.SOCIAL_GOOGLE_CLIENT_ID;
    else process.env.SOCIAL_GOOGLE_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_GOOGLE_CLIENT_SECRET;
    else process.env.SOCIAL_GOOGLE_CLIENT_SECRET = previousClientSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  process.env.SOCIAL_GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.SOCIAL_GOOGLE_CLIENT_SECRET = 'google-client-secret';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');

  const result = await freshSocialAuth.startOAuth('google', {
    sub: 'author-sub',
    username: 'author'
  }, {
    returnUrl: 'https://author.grayson-wills.com/distribution'
  });

  const url = new URL(result.authUrl);
  assert.equal(`${url.origin}${url.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'google-client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.grayson-wills.com/api/social-auth/google/callback');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('scope').includes('https://www.googleapis.com/auth/gmail.modify'));
  assert.ok(url.searchParams.get('scope').includes('https://www.googleapis.com/auth/youtube.upload'));
});

test('refreshes Google access tokens using the stored encrypted refresh token', async (t) => {
  const originalFetch = global.fetch;
  const previousClientId = process.env.SOCIAL_GOOGLE_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_GOOGLE_CLIENT_SECRET;
  const previousTokenSecret = process.env.SOCIAL_AUTH_TOKEN_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    global.fetch = originalFetch;
    if (previousClientId === undefined) delete process.env.SOCIAL_GOOGLE_CLIENT_ID;
    else process.env.SOCIAL_GOOGLE_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_GOOGLE_CLIENT_SECRET;
    else process.env.SOCIAL_GOOGLE_CLIENT_SECRET = previousClientSecret;
    if (previousTokenSecret === undefined) delete process.env.SOCIAL_AUTH_TOKEN_SECRET;
    else process.env.SOCIAL_AUTH_TOKEN_SECRET = previousTokenSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  process.env.SOCIAL_GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.SOCIAL_GOOGLE_CLIENT_SECRET = 'google-client-secret';
  process.env.SOCIAL_AUTH_TOKEN_SECRET = 'test-social-token-secret-32-chars-minimum';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');
  const user = {
    sub: 'author-sub',
    username: 'author'
  };
  const tokenRequests = [];

  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(String(options.body || ''));
      tokenRequests.push({
        grantType: params.get('grant_type'),
        refreshToken: params.get('refresh_token'),
        clientSecret: params.get('client_secret')
      });
      assert.equal(params.get('client_id'), 'google-client-id');
      assert.equal(params.get('client_secret'), 'google-client-secret');

      if (params.get('grant_type') === 'authorization_code') {
        assert.equal(params.get('redirect_uri'), 'https://api.grayson-wills.com/api/social-auth/google/callback');
        assert.ok(params.get('code_verifier'));
        return {
          ok: true,
          text: async () => JSON.stringify({
            access_token: 'old-google-access-token',
            refresh_token: 'google-refresh-token',
            token_type: 'Bearer',
            expires_in: 1,
            scope: freshSocialAuth.getProviderConfig('google').scopes.join(' ')
          })
        };
      }

      if (params.get('grant_type') === 'refresh_token') {
        assert.equal(params.get('refresh_token'), 'google-refresh-token');
        return {
          ok: true,
          text: async () => JSON.stringify({
            access_token: 'new-google-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: freshSocialAuth.getProviderConfig('google').scopes.join(' ')
          })
        };
      }
    }

    if (href === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return {
        ok: true,
        text: async () => JSON.stringify({
          sub: 'google-sub',
          email: 'author@example.test',
          name: 'Author Name',
          picture: 'https://example.test/avatar.png'
        })
      };
    }

    throw new Error(`Unexpected fetch ${href}`);
  };

  const start = await freshSocialAuth.startOAuth('google', user, {
    returnUrl: 'https://author.grayson-wills.com/distribution'
  });
  const state = new URL(start.authUrl).searchParams.get('state');
  await freshSocialAuth.completeOAuth('google', {
    code: 'oauth-code',
    state
  });

  const statuses = await freshSocialAuth.getProviderStatus(user);
  const googleStatus = statuses.find((status) => status.provider === 'google');
  assert.equal(googleStatus.status, 'connected');
  assert.equal(googleStatus.connected, true);
  assert.equal(googleStatus.accountLabel, 'author@example.test');
  assert.equal(googleStatus.credentialArtifacts.hasRefreshToken, true);
  assert.equal(googleStatus.credentialArtifacts.expiresInSeconds, 3600);

  const credential = await freshSocialAuth.getPostingCredential('google', user);
  assert.equal(credential.token.access_token, 'new-google-access-token');
  assert.equal(credential.token.refresh_token, 'google-refresh-token');
  assert.deepEqual(tokenRequests.map((request) => request.grantType), ['authorization_code', 'refresh_token']);

  const refreshed = memory.valuesForTable('social-auth-test').find((item) => item.provider === 'google');
  assert.equal(refreshed.credentialArtifacts.expiresInSeconds, 3600);
  assert.equal(JSON.stringify(refreshed).includes('new-google-access-token'), false);
  assert.equal(JSON.stringify(refreshed).includes('google-refresh-token'), false);
});

test('marks existing LinkedIn connections as needing reconnect when r_profile_basicinfo is missing', async (t) => {
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

  await memory.ddb.send(new PutCommand({
    TableName: process.env.SOCIAL_AUTH_TABLE_NAME,
    Item: {
      pk: 'USER#author-sub',
      sk: 'PROVIDER#linkedin',
      provider: 'linkedin',
      providerFamily: 'linkedin',
      username: 'author',
      accountLabel: 'Author Name',
      scope: 'email,openid,profile,w_member_social',
      connectedAt: '2026-06-23T01:14:14.932Z',
      updatedAt: '2026-06-23T01:14:14.932Z',
      expiresAtMs: Date.now() + 3600_000,
      selectedAccount: {
        id: 'member-id',
        label: 'Author Name',
        handle: 'author@example.test',
        platform: 'linkedin'
      }
    }
  }));

  const statuses = await freshSocialAuth.getProviderStatus({
    sub: 'author-sub',
    username: 'author'
  });
  const linkedinStatus = statuses.find((status) => status.provider === 'linkedin');
  assert.equal(linkedinStatus.status, 'needs-reconnect');
  assert.equal(linkedinStatus.connected, false);
  assert.equal(linkedinStatus.needsReconnect, true);
  assert.deepEqual(linkedinStatus.missingScopes, ['r_profile_basicinfo']);
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

test('builds tiktok provider config with TikTok OAuth endpoints', () => {
  const config = socialAuth.getProviderConfig('tiktok');
  assert.equal(config.id, 'tiktok');
  assert.equal(config.family, 'tiktok');
  assert.equal(config.authUrl, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(config.tokenUrl, 'https://open.tiktokapis.com/v2/oauth/token/');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/tiktok/callback');
  assert.deepEqual(config.scopes, ['user.info.basic', 'video.upload', 'video.publish']);
  assert.equal(config.scopeSeparator, ',');
  assert.equal(config.clientIdParam, 'client_key');
});

test('builds reddit provider config with permanent OAuth and basic token auth', () => {
  const config = socialAuth.getProviderConfig('reddit');
  assert.equal(config.id, 'reddit');
  assert.equal(config.family, 'reddit');
  assert.equal(config.authUrl, 'https://www.reddit.com/api/v1/authorize');
  assert.equal(config.tokenUrl, 'https://www.reddit.com/api/v1/access_token');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/reddit/callback');
  assert.deepEqual(config.scopes, ['identity', 'submit', 'read', 'mysubreddits']);
  assert.equal(config.scopeSeparator, ' ');
  assert.equal(config.tokenAuth, 'basic');
  assert.deepEqual(config.authParams, { duration: 'permanent' });
});

test('builds pinterest provider config with comma scopes and basic token auth', () => {
  const config = socialAuth.getProviderConfig('pinterest');
  assert.equal(config.id, 'pinterest');
  assert.equal(config.family, 'pinterest');
  assert.equal(config.authUrl, 'https://www.pinterest.com/oauth/');
  assert.equal(config.tokenUrl, 'https://api.pinterest.com/v5/oauth/token');
  assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/pinterest/callback');
  assert.deepEqual(config.scopes, ['user_accounts:read', 'boards:read', 'pins:read', 'pins:write']);
  assert.equal(config.scopeSeparator, ',');
  assert.equal(config.tokenAuth, 'basic');
});

test('builds mastodon provider config from configured instance URL', () => {
  const previousInstance = process.env.SOCIAL_MASTODON_INSTANCE_URL;
  const previousAltInstance = process.env.MASTODON_INSTANCE_URL;
  process.env.SOCIAL_MASTODON_INSTANCE_URL = 'https://mastodon.example/';
  delete process.env.MASTODON_INSTANCE_URL;

  try {
    const config = socialAuth.getProviderConfig('mastodon');
    assert.equal(config.id, 'mastodon');
    assert.equal(config.family, 'mastodon');
    assert.equal(config.authUrl, 'https://mastodon.example/oauth/authorize');
    assert.equal(config.tokenUrl, 'https://mastodon.example/oauth/token');
    assert.equal(config.apiBaseUrl, 'https://mastodon.example');
    assert.equal(config.redirectUri, 'https://api.grayson-wills.com/api/social-auth/mastodon/callback');
    assert.deepEqual(config.scopes, ['read:accounts', 'write:statuses']);
  } finally {
    if (previousInstance === undefined) delete process.env.SOCIAL_MASTODON_INSTANCE_URL;
    else process.env.SOCIAL_MASTODON_INSTANCE_URL = previousInstance;
    if (previousAltInstance === undefined) delete process.env.MASTODON_INSTANCE_URL;
    else process.env.MASTODON_INSTANCE_URL = previousAltInstance;
  }
});

test('marks mastodon as unconfigured without an instance URL', () => {
  const previousClientId = process.env.SOCIAL_MASTODON_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_MASTODON_CLIENT_SECRET;
  const previousInstance = process.env.SOCIAL_MASTODON_INSTANCE_URL;
  const previousAltInstance = process.env.MASTODON_INSTANCE_URL;
  process.env.SOCIAL_MASTODON_CLIENT_ID = 'mastodon-client';
  process.env.SOCIAL_MASTODON_CLIENT_SECRET = 'mastodon-secret';
  delete process.env.SOCIAL_MASTODON_INSTANCE_URL;
  delete process.env.MASTODON_INSTANCE_URL;

  try {
    const config = socialAuth.getProviderConfig('mastodon');
    const publicConfig = socialAuth.providerPublicConfig(config);
    assert.equal(publicConfig.configured, false);
  } finally {
    if (previousClientId === undefined) delete process.env.SOCIAL_MASTODON_CLIENT_ID;
    else process.env.SOCIAL_MASTODON_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_MASTODON_CLIENT_SECRET;
    else process.env.SOCIAL_MASTODON_CLIENT_SECRET = previousClientSecret;
    if (previousInstance === undefined) delete process.env.SOCIAL_MASTODON_INSTANCE_URL;
    else process.env.SOCIAL_MASTODON_INSTANCE_URL = previousInstance;
    if (previousAltInstance === undefined) delete process.env.MASTODON_INSTANCE_URL;
    else process.env.MASTODON_INSTANCE_URL = previousAltInstance;
  }
});

test('builds tumblr and medium provider configs', () => {
  const tumblr = socialAuth.getProviderConfig('tumblr');
  assert.equal(tumblr.id, 'tumblr');
  assert.equal(tumblr.family, 'tumblr');
  assert.equal(tumblr.authUrl, 'https://www.tumblr.com/oauth2/authorize');
  assert.equal(tumblr.tokenUrl, 'https://api.tumblr.com/v2/oauth2/token');
  assert.equal(tumblr.redirectUri, 'https://api.grayson-wills.com/api/social-auth/tumblr/callback');
  assert.deepEqual(tumblr.scopes, ['basic', 'write']);

  const medium = socialAuth.getProviderConfig('medium');
  assert.equal(medium.id, 'medium');
  assert.equal(medium.family, 'medium');
  assert.equal(medium.authUrl, 'https://medium.com/m/oauth/authorize');
  assert.equal(medium.tokenUrl, 'https://api.medium.com/v1/tokens');
  assert.equal(medium.redirectUri, 'https://api.grayson-wills.com/api/social-auth/medium/callback');
  assert.deepEqual(medium.scopes, ['basicProfile', 'publishPost']);
});

test('builds TikTok OAuth authorize URLs with client_key and comma scopes', async (t) => {
  const previousClientKey = process.env.SOCIAL_TIKTOK_CLIENT_KEY;
  const previousClientSecret = process.env.SOCIAL_TIKTOK_CLIENT_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    if (previousClientKey === undefined) delete process.env.SOCIAL_TIKTOK_CLIENT_KEY;
    else process.env.SOCIAL_TIKTOK_CLIENT_KEY = previousClientKey;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_TIKTOK_CLIENT_SECRET;
    else process.env.SOCIAL_TIKTOK_CLIENT_SECRET = previousClientSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  process.env.SOCIAL_TIKTOK_CLIENT_KEY = 'tiktok-client-key';
  process.env.SOCIAL_TIKTOK_CLIENT_SECRET = 'tiktok-client-secret';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');

  const result = await freshSocialAuth.startOAuth('tiktok', {
    sub: 'author-sub',
    username: 'author'
  }, {
    returnUrl: 'https://author.grayson-wills.com/distribution'
  });

  const url = new URL(result.authUrl);
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(url.searchParams.get('client_key'), 'tiktok-client-key');
  assert.equal(url.searchParams.get('client_id'), null);
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.upload,video.publish');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.grayson-wills.com/api/social-auth/tiktok/callback');
});

test('builds Reddit OAuth authorize URLs with duration permanent and space scopes', async (t) => {
  const previousClientId = process.env.SOCIAL_REDDIT_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_REDDIT_CLIENT_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    if (previousClientId === undefined) delete process.env.SOCIAL_REDDIT_CLIENT_ID;
    else process.env.SOCIAL_REDDIT_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_REDDIT_CLIENT_SECRET;
    else process.env.SOCIAL_REDDIT_CLIENT_SECRET = previousClientSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  process.env.SOCIAL_REDDIT_CLIENT_ID = 'reddit-client';
  process.env.SOCIAL_REDDIT_CLIENT_SECRET = 'reddit-secret';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');

  const result = await freshSocialAuth.startOAuth('reddit', {
    sub: 'author-sub',
    username: 'author'
  }, {
    returnUrl: 'https://author.grayson-wills.com/distribution'
  });

  const url = new URL(result.authUrl);
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.reddit.com/api/v1/authorize');
  assert.equal(url.searchParams.get('client_id'), 'reddit-client');
  assert.equal(url.searchParams.get('scope'), 'identity submit read mysubreddits');
  assert.equal(url.searchParams.get('duration'), 'permanent');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.grayson-wills.com/api/social-auth/reddit/callback');
});

test('builds Pinterest OAuth authorize URLs with comma scopes', async (t) => {
  const previousClientId = process.env.SOCIAL_PINTEREST_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_PINTEREST_CLIENT_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;

  t.after(() => {
    if (previousClientId === undefined) delete process.env.SOCIAL_PINTEREST_CLIENT_ID;
    else process.env.SOCIAL_PINTEREST_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_PINTEREST_CLIENT_SECRET;
    else process.env.SOCIAL_PINTEREST_CLIENT_SECRET = previousClientSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  process.env.SOCIAL_PINTEREST_CLIENT_ID = 'pinterest-client';
  process.env.SOCIAL_PINTEREST_CLIENT_SECRET = 'pinterest-secret';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');

  const result = await freshSocialAuth.startOAuth('pinterest', {
    sub: 'author-sub',
    username: 'author'
  }, {
    returnUrl: 'https://author.grayson-wills.com/distribution'
  });

  const url = new URL(result.authUrl);
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.pinterest.com/oauth/');
  assert.equal(url.searchParams.get('client_id'), 'pinterest-client');
  assert.equal(url.searchParams.get('scope'), 'user_accounts:read,boards:read,pins:read,pins:write');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.grayson-wills.com/api/social-auth/pinterest/callback');
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

test('imports Threads access tokens without local browser OAuth', async (t) => {
  const originalFetch = global.fetch;
  const previousTokenSecret = process.env.SOCIAL_AUTH_TOKEN_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;
  const previousClientId = process.env.SOCIAL_THREADS_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_THREADS_CLIENT_SECRET;

  t.after(() => {
    global.fetch = originalFetch;
    if (previousTokenSecret === undefined) delete process.env.SOCIAL_AUTH_TOKEN_SECRET;
    else process.env.SOCIAL_AUTH_TOKEN_SECRET = previousTokenSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    if (previousClientId === undefined) delete process.env.SOCIAL_THREADS_CLIENT_ID;
    else process.env.SOCIAL_THREADS_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_THREADS_CLIENT_SECRET;
    else process.env.SOCIAL_THREADS_CLIENT_SECRET = previousClientSecret;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  delete process.env.SOCIAL_THREADS_CLIENT_ID;
  delete process.env.SOCIAL_THREADS_CLIENT_SECRET;
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
          access_token: 'refreshed-threads-token',
          token_type: 'bearer',
          expires_in: 5_184_000
        })
      };
    }

    return {
      ok: true,
      text: async () => JSON.stringify({
        id: '1234567890',
        username: 'graysonwills',
        name: 'Grayson Wills',
        threads_profile_picture_url: 'https://example.test/threads.jpg'
      })
    };
  };

  const user = {
    sub: 'author-sub',
    username: 'author'
  };
  const result = await freshSocialAuth.importProviderToken('threads', user, {
    accessToken: 'original-threads-access-token'
  });

  assert.equal(result.provider, 'threads');
  assert.equal(result.selectedAccount.id, '1234567890');
  assert.equal(result.selectedAccount.handle, '@graysonwills');
  assert.equal(result.refreshed, true);

  const stored = memory.valuesForTable('social-auth-test');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].providerFamily, 'threads');
  assert.equal(stored[0].connectionMethod, 'token-import');
  assert.equal(JSON.stringify(stored[0]).includes('original-threads-access-token'), false);
  assert.equal(JSON.stringify(stored[0]).includes('refreshed-threads-token'), false);

  const statuses = await freshSocialAuth.getProviderStatus(user);
  const threadsStatus = statuses.find((status) => status.provider === 'threads');
  assert.equal(threadsStatus.configured, true);
  assert.equal(threadsStatus.connected, true);
  assert.equal(threadsStatus.accountLabel, '@graysonwills');
});

test('refreshes expiring imported Threads tokens during status checks', async (t) => {
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
  let refreshCallCount = 0;

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/refresh_access_token')) {
      refreshCallCount += 1;
      return {
        ok: true,
        text: async () => JSON.stringify({
          access_token: `refreshed-threads-token-${refreshCallCount}`,
          token_type: 'bearer',
          expires_in: refreshCallCount === 1 ? 1 : 5_184_000
        })
      };
    }

    return {
      ok: true,
      text: async () => JSON.stringify({
        id: '1234567890',
        username: 'graysonwills',
        name: 'Grayson Wills'
      })
    };
  };

  const user = {
    sub: 'author-sub',
    username: 'author'
  };

  await freshSocialAuth.importProviderToken('threads', user, {
    accessToken: 'original-threads-access-token'
  });
  const statuses = await freshSocialAuth.getProviderStatus(user);
  const threadsStatus = statuses.find((status) => status.provider === 'threads');

  assert.equal(refreshCallCount, 2);
  assert.equal(threadsStatus.connected, true);
  const stored = memory.valuesForTable('social-auth-test')[0];
  assert.ok(stored.tokenRefreshedAt);
  assert.equal(JSON.stringify(stored).includes('refreshed-threads-token-2'), false);
});

test('imports Mastodon access tokens with an explicit instance URL', async (t) => {
  const originalFetch = global.fetch;
  const previousTokenSecret = process.env.SOCIAL_AUTH_TOKEN_SECRET;
  const previousTableName = process.env.SOCIAL_AUTH_TABLE_NAME;
  const previousInstanceUrl = process.env.SOCIAL_MASTODON_INSTANCE_URL;
  const previousClientId = process.env.SOCIAL_MASTODON_CLIENT_ID;
  const previousClientSecret = process.env.SOCIAL_MASTODON_CLIENT_SECRET;

  t.after(() => {
    global.fetch = originalFetch;
    if (previousTokenSecret === undefined) delete process.env.SOCIAL_AUTH_TOKEN_SECRET;
    else process.env.SOCIAL_AUTH_TOKEN_SECRET = previousTokenSecret;
    if (previousTableName === undefined) delete process.env.SOCIAL_AUTH_TABLE_NAME;
    else process.env.SOCIAL_AUTH_TABLE_NAME = previousTableName;
    if (previousInstanceUrl === undefined) delete process.env.SOCIAL_MASTODON_INSTANCE_URL;
    else process.env.SOCIAL_MASTODON_INSTANCE_URL = previousInstanceUrl;
    if (previousClientId === undefined) delete process.env.SOCIAL_MASTODON_CLIENT_ID;
    else process.env.SOCIAL_MASTODON_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SOCIAL_MASTODON_CLIENT_SECRET;
    else process.env.SOCIAL_MASTODON_CLIENT_SECRET = previousClientSecret;
    clearPortfolioModuleCache();
  });

  setMcpTestEnv();
  delete process.env.SOCIAL_MASTODON_INSTANCE_URL;
  delete process.env.SOCIAL_MASTODON_CLIENT_ID;
  delete process.env.SOCIAL_MASTODON_CLIENT_SECRET;
  process.env.SOCIAL_AUTH_TOKEN_SECRET = 'test-social-token-secret-32-chars-minimum';
  const memory = createMemoryDdb();
  installFakeAws(memory);
  const freshSocialAuth = require('../src/services/social-auth');

  global.fetch = async (url) => {
    assert.equal(String(url), 'https://mastodon.social/api/v1/accounts/verify_credentials');
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: '109123456789',
        acct: 'graysonwills',
        display_name: 'Grayson Wills',
        avatar: 'https://mastodon.social/avatar.jpg',
        url: 'https://mastodon.social/@graysonwills'
      })
    };
  };

  const result = await freshSocialAuth.importProviderToken('mastodon', {
    sub: 'author-sub',
    username: 'author'
  }, {
    accessToken: 'mastodon-access-token-for-import',
    instanceUrl: 'https://mastodon.social/@graysonwills'
  });

  assert.equal(result.provider, 'mastodon');
  assert.equal(result.selectedAccount.id, '109123456789');
  assert.equal(result.selectedAccount.handle, '@graysonwills');
  assert.equal(result.refreshed, false);

  const stored = memory.valuesForTable('social-auth-test');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].providerFamily, 'mastodon');
  assert.equal(stored[0].connectionMethod, 'token-import');
  assert.equal(stored[0].selectedAccount.extra.instanceUrl, 'https://mastodon.social');
  assert.equal(JSON.stringify(stored[0]).includes('mastodon-access-token-for-import'), false);
});
