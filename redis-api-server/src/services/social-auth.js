const crypto = require('crypto');
const {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand
} = require('@aws-sdk/lib-dynamodb');

const { getDdbDoc } = require('./aws/clients');
const { randomToken, sha256Hex } = require('../utils/crypto');

const DEFAULT_SOCIAL_AUTH_TABLE = 'portfolio-social-auth';
const STATE_TTL_SECONDS = 10 * 60;
const MAX_RETURN_URL_CHARS = 600;

const PROVIDERS = {
  x: {
    id: 'x',
    label: 'X / Twitter',
    family: 'x',
    clientIdEnv: ['SOCIAL_X_CLIENT_ID', 'X_CLIENT_ID', 'TWITTER_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_X_CLIENT_SECRET', 'X_CLIENT_SECRET', 'TWITTER_CLIENT_SECRET'],
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'],
    pkce: true
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    family: 'linkedin',
    clientIdEnv: ['SOCIAL_LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_LINKEDIN_CLIENT_SECRET', 'LINKEDIN_CLIENT_SECRET'],
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'email', 'w_member_social'],
    pkce: false
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook Page',
    family: 'meta',
    clientIdEnv: ['SOCIAL_META_CLIENT_ID', 'META_CLIENT_ID', 'FACEBOOK_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_META_CLIENT_SECRET', 'META_CLIENT_SECRET', 'FACEBOOK_CLIENT_SECRET'],
    authUrl: 'https://www.facebook.com/v22.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v22.0/oauth/access_token',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    pkce: false
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    family: 'meta',
    clientIdEnv: ['SOCIAL_META_CLIENT_ID', 'META_CLIENT_ID', 'FACEBOOK_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_META_CLIENT_SECRET', 'META_CLIENT_SECRET', 'FACEBOOK_CLIENT_SECRET'],
    authUrl: 'https://www.facebook.com/v22.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v22.0/oauth/access_token',
    scopes: ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'],
    pkce: false
  }
};

const PROVIDER_ALIASES = {
  twitter: 'x',
  meta: 'facebook'
};

const SECRET_TOKEN_FIELDS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret'
]);

function getTableName() {
  return String(process.env.SOCIAL_AUTH_TABLE_NAME || DEFAULT_SOCIAL_AUTH_TABLE).trim();
}

function getEnvValue(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function normalizeProviderId(provider) {
  const value = String(provider || '').trim().toLowerCase();
  const normalized = PROVIDER_ALIASES[value] || value;
  if (!PROVIDERS[normalized]) {
    const err = new Error('Unsupported social provider');
    err.status = 404;
    throw err;
  }
  return normalized;
}

function getProviderConfig(provider) {
  const id = normalizeProviderId(provider);
  const config = PROVIDERS[id];
  return {
    ...config,
    clientId: getEnvValue(config.clientIdEnv),
    clientSecret: getEnvValue(config.clientSecretEnv),
    redirectUri: getRedirectUri(id)
  };
}

function getPublicApiBaseUrl() {
  return String(
    process.env.SOCIAL_AUTH_PUBLIC_API_BASE_URL
    || process.env.PUBLIC_API_BASE_URL
    || 'https://api.grayson-wills.com/api'
  ).replace(/\/+$/, '');
}

function getRedirectUri(provider) {
  const base = String(process.env.SOCIAL_AUTH_REDIRECT_BASE_URL || '').trim()
    || `${getPublicApiBaseUrl()}/social-auth`;
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(provider)}/callback`;
}

function getDefaultReturnUrl() {
  return String(
    process.env.SOCIAL_AUTH_DEFAULT_RETURN_URL
    || process.env.BLOG_AUTHORING_URL
    || 'https://author.grayson-wills.com/distribution'
  ).trim();
}

function getAllowedReturnOrigins() {
  const defaults = [
    'https://author.grayson-wills.com',
    'https://d39s45clv1oor3.cloudfront.net',
    'http://localhost:4201',
    'http://localhost:4211',
    'http://localhost:4301'
  ];
  const configured = String(process.env.SOCIAL_AUTH_ALLOWED_RETURN_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set([...defaults, ...configured]);
}

function normalizeReturnUrl(input) {
  const fallback = getDefaultReturnUrl();
  const value = String(input || fallback).trim().slice(0, MAX_RETURN_URL_CHARS);

  try {
    const url = new URL(value);
    const origin = `${url.protocol}//${url.host}`;
    if (getAllowedReturnOrigins().has(origin)) return url.toString();
  } catch {
    // fall through
  }

  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function epochSeconds(ms = Date.now()) {
  return Math.floor(ms / 1000);
}

function codeChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

function getTokenSecret() {
  const secret = String(process.env.SOCIAL_AUTH_TOKEN_SECRET || process.env.TOKEN_ENCRYPTION_SECRET || '').trim();
  if (!secret || secret.length < 32) {
    const err = new Error('Social token encryption secret is not configured');
    err.status = 500;
    throw err;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptJson(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getTokenSecret(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload || {}), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    value: encrypted.toString('base64')
  };
}

function decryptJson(envelope) {
  if (!envelope || envelope.alg !== 'aes-256-gcm' || !envelope.iv || !envelope.tag || !envelope.value) {
    const err = new Error('Stored social token payload is invalid');
    err.status = 500;
    throw err;
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getTokenSecret(),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.value, 'base64')),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

function summarizeTokenPayload(payload = {}, config = {}) {
  const scope = String(payload.scope || (Array.isArray(config.scopes) ? config.scopes.join(' ') : '')).trim();
  const expiresInSeconds = Number(payload.expires_in || 0);
  return {
    tokenType: String(payload.token_type || 'Bearer'),
    hasAccessToken: Boolean(payload.access_token),
    hasRefreshToken: Boolean(payload.refresh_token),
    hasIdToken: Boolean(payload.id_token),
    scope,
    expiresInSeconds: expiresInSeconds > 0 ? expiresInSeconds : null,
    providerFields: Object.keys(payload)
      .filter((key) => !SECRET_TOKEN_FIELDS.has(key))
      .sort()
  };
}

function userKey(user) {
  const sub = String(user?.sub || user?.['cognito:username'] || user?.username || '').trim();
  if (!sub) {
    const err = new Error('Authenticated user identity is missing');
    err.status = 401;
    throw err;
  }
  return sub;
}

function usernameForUser(user) {
  return String(user?.['cognito:username'] || user?.username || user?.email || user?.sub || '').trim();
}

function connectionKey(userSub, provider) {
  return {
    pk: `USER#${userSub}`,
    sk: `PROVIDER#${provider}`
  };
}

function stateKey(state) {
  return {
    pk: `STATE#${sha256Hex(state)}`,
    sk: 'STATE'
  };
}

function providerPublicConfig(config) {
  return {
    provider: config.id,
    label: config.label,
    family: config.family,
    configured: Boolean(config.clientId && config.clientSecret),
    scopes: config.scopes,
    redirectUri: config.redirectUri
  };
}

function toConnectionStatus(config, item) {
  const expiresAtMs = item?.expiresAtMs ? Number(item.expiresAtMs) : null;
  const expired = expiresAtMs ? Date.now() >= expiresAtMs : false;
  return {
    ...providerPublicConfig(config),
    connected: Boolean(item && !expired),
    status: !item ? 'not-connected' : expired ? 'expired' : 'connected',
    connectedAt: item?.connectedAt || null,
    updatedAt: item?.updatedAt || null,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    accountLabel: item?.accountLabel || '',
    scope: item?.scope || config.scopes.join(' '),
    credentialArtifacts: item?.credentialArtifacts || null
  };
}

async function getProviderStatus(user) {
  const userSub = userKey(user);
  let resp = { Items: [] };

  try {
    resp = await getDdbDoc().send(new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'pk',
        '#sk': 'sk'
      },
      ExpressionAttributeValues: {
        ':pk': `USER#${userSub}`,
        ':prefix': 'PROVIDER#'
      }
    }));
  } catch (err) {
    if (err?.name !== 'ResourceNotFoundException') throw err;
  }

  const byProvider = new Map((resp?.Items || []).map((item) => [String(item.provider || ''), item]));
  return Object.values(PROVIDERS).map((baseConfig) => {
    const config = getProviderConfig(baseConfig.id);
    return toConnectionStatus(config, byProvider.get(config.id));
  });
}

async function startOAuth(provider, user, { returnUrl = '' } = {}) {
  const config = getProviderConfig(provider);
  if (!config.clientId || !config.clientSecret) {
    const err = new Error(`${config.label} OAuth is not configured`);
    err.status = 503;
    err.details = providerPublicConfig(config);
    throw err;
  }

  const state = randomToken(32);
  const verifier = config.pkce ? randomToken(48) : '';
  const safeReturnUrl = normalizeReturnUrl(returnUrl);
  const userSub = userKey(user);
  const ttl = epochSeconds() + STATE_TTL_SECONDS;

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: {
      ...stateKey(state),
      provider: config.id,
      userSub,
      username: usernameForUser(user),
      returnUrl: safeReturnUrl,
      codeVerifier: verifier || undefined,
      createdAt: nowIso(),
      expiresAtEpoch: ttl
    },
    ConditionExpression: 'attribute_not_exists(pk)'
  }));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state
  });

  params.set('scope', config.family === 'meta' ? config.scopes.join(',') : config.scopes.join(' '));

  if (config.pkce) {
    params.set('code_challenge', codeChallenge(verifier));
    params.set('code_challenge_method', 'S256');
  }

  return {
    provider: config.id,
    label: config.label,
    authUrl: `${config.authUrl}?${params.toString()}`,
    expiresInSeconds: STATE_TTL_SECONDS
  };
}

async function completeOAuth(provider, { code, state }) {
  const config = getProviderConfig(provider);
  const safeCode = String(code || '').trim();
  const safeState = String(state || '').trim();
  if (!safeCode || !safeState) {
    const err = new Error('OAuth code and state are required');
    err.status = 400;
    throw err;
  }

  const stateResp = await getDdbDoc().send(new GetCommand({
    TableName: getTableName(),
    Key: stateKey(safeState),
    ConsistentRead: true
  }));
  const stateItem = stateResp?.Item;
  if (!stateItem || stateItem.provider !== config.id || Number(stateItem.expiresAtEpoch || 0) < epochSeconds()) {
    const err = new Error('OAuth state is invalid or expired');
    err.status = 400;
    throw err;
  }

  let tokenPayload = await exchangeCodeForToken(config, safeCode, stateItem.codeVerifier || '');
  if (config.family === 'meta' && tokenPayload?.access_token && process.env.SOCIAL_META_SKIP_LONG_LIVED_EXCHANGE !== 'true') {
    tokenPayload = await exchangeMetaLongLivedToken(config, tokenPayload.access_token).catch(() => tokenPayload);
  }

  const expiresInSeconds = Number(tokenPayload?.expires_in || 0);
  const expiresAtMs = expiresInSeconds > 0 ? Date.now() + (expiresInSeconds * 1000) : null;
  const scope = String(tokenPayload?.scope || config.scopes.join(' '));
  const accountLabel = await fetchAccountLabel(config, tokenPayload?.access_token).catch(() => '');

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: {
      ...connectionKey(stateItem.userSub, config.id),
      provider: config.id,
      providerFamily: config.family,
      username: stateItem.username || '',
      accountLabel,
      token: encryptJson(tokenPayload),
      credentialArtifacts: summarizeTokenPayload(tokenPayload, config),
      scope,
      connectedAt: nowIso(),
      updatedAt: nowIso(),
      expiresAtMs: expiresAtMs || undefined
    }
  }));

  await getDdbDoc().send(new DeleteCommand({
    TableName: getTableName(),
    Key: stateKey(safeState)
  }));

  return {
    provider: config.id,
    returnUrl: buildReturnUrl(stateItem.returnUrl, config.id, 'connected')
  };
}

async function getPostingCredential(provider, user) {
  const config = getProviderConfig(provider);
  const res = await getDdbDoc().send(new GetCommand({
    TableName: getTableName(),
    Key: connectionKey(userKey(user), config.id),
    ConsistentRead: true
  }));

  const item = res?.Item;
  if (!item?.token) {
    const err = new Error(`${config.label} is not connected`);
    err.status = 404;
    throw err;
  }

  const expiresAtMs = item.expiresAtMs ? Number(item.expiresAtMs) : null;
  if (expiresAtMs && Date.now() >= expiresAtMs) {
    const err = new Error(`${config.label} token is expired`);
    err.status = 409;
    throw err;
  }

  return {
    provider: config.id,
    family: config.family,
    accountLabel: item.accountLabel || '',
    scope: item.scope || '',
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    token: decryptJson(item.token)
  };
}

async function exchangeCodeForToken(config, code, verifier) {
  if (config.family === 'meta') {
    const url = new URL(config.tokenUrl);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('client_secret', config.clientSecret);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('code', code);
    return fetchJson(url.toString(), { method: 'GET' });
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId
  });
  if (verifier) params.set('code_verifier', verifier);
  if (config.family === 'linkedin') params.set('client_secret', config.clientSecret);

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (config.family === 'x' && config.clientSecret) {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  return fetchJson(config.tokenUrl, {
    method: 'POST',
    headers,
    body: params.toString()
  });
}

async function exchangeMetaLongLivedToken(config, shortToken) {
  const url = new URL(config.tokenUrl);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('client_secret', config.clientSecret);
  url.searchParams.set('fb_exchange_token', shortToken);
  return fetchJson(url.toString(), { method: 'GET' });
}

async function fetchAccountLabel(config, accessToken) {
  if (!accessToken) return '';
  let url = '';
  if (config.family === 'x') url = 'https://api.twitter.com/2/users/me?user.fields=username';
  if (config.family === 'linkedin') url = 'https://api.linkedin.com/v2/userinfo';
  if (config.family === 'meta') url = 'https://graph.facebook.com/v22.0/me?fields=id,name';
  if (!url) return '';

  const payload = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (config.family === 'x') return payload?.data?.username ? `@${payload.data.username}` : '';
  if (config.family === 'linkedin') return payload?.name || payload?.email || '';
  if (config.family === 'meta') return payload?.name || '';
  return '';
}

async function disconnectProvider(provider, user) {
  const config = getProviderConfig(provider);
  await getDdbDoc().send(new DeleteCommand({
    TableName: getTableName(),
    Key: connectionKey(userKey(user), config.id)
  }));
  return { provider: config.id, disconnected: true };
}

function buildReturnUrl(returnUrl, provider, status) {
  const url = new URL(normalizeReturnUrl(returnUrl));
  url.searchParams.set('socialProvider', provider);
  url.searchParams.set('socialStatus', status);
  return url.toString();
}

async function buildOAuthReturnUrl(provider, { state = '', status = 'error', error = '' } = {}) {
  const config = getProviderConfig(provider);
  let returnUrl = '';
  const safeState = String(state || '').trim();

  if (safeState) {
    try {
      const stateResp = await getDdbDoc().send(new GetCommand({
        TableName: getTableName(),
        Key: stateKey(safeState),
        ConsistentRead: true
      }));
      const stateItem = stateResp?.Item;
      if (stateItem?.provider === config.id) returnUrl = stateItem.returnUrl || '';
    } catch {
      // Fall back to the default authoring return URL.
    }
  }

  const url = new URL(buildReturnUrl(returnUrl, config.id, status));
  const safeError = String(error || '').trim().slice(0, 180);
  if (safeError) url.searchParams.set('socialError', safeError);
  return url.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(payload?.error_description || payload?.error?.message || payload?.error || `HTTP ${response.status}`);
    err.status = response.status;
    err.details = payload;
    throw err;
  }

  return payload || {};
}

module.exports = {
  PROVIDERS,
  normalizeProviderId,
  getProviderConfig,
  getProviderStatus,
  startOAuth,
  completeOAuth,
  disconnectProvider,
  getPostingCredential,
  normalizeReturnUrl,
  providerPublicConfig,
  summarizeTokenPayload,
  buildOAuthReturnUrl
};
