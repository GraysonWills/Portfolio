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
const TOKEN_REFRESH_SKEW_MS = 10 * 60 * 1000;
const DEFAULT_GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/drive.file'
];

const PROVIDERS = {
  x: {
    id: 'x',
    label: 'X / Twitter',
    family: 'x',
    clientIdEnv: ['SOCIAL_X_CLIENT_ID', 'X_CLIENT_ID', 'TWITTER_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_X_CLIENT_SECRET', 'X_CLIENT_SECRET', 'TWITTER_CLIENT_SECRET'],
    authUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'dm.read', 'dm.write', 'offline.access'],
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
    scopes: ['openid', 'profile', 'email', 'r_profile_basicinfo', 'w_member_social'],
    pkce: false
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook Page',
    family: 'meta',
    clientIdEnv: ['SOCIAL_META_CLIENT_ID', 'META_CLIENT_ID', 'FACEBOOK_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_META_CLIENT_SECRET', 'META_CLIENT_SECRET', 'FACEBOOK_CLIENT_SECRET'],
    configIdEnv: ['SOCIAL_FACEBOOK_CONFIG_ID', 'FACEBOOK_CONFIG_ID', 'SOCIAL_META_FACEBOOK_CONFIG_ID', 'SOCIAL_META_CONFIG_ID'],
    authUrl: 'https://www.facebook.com/v22.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v22.0/oauth/access_token',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    pkce: false
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    family: 'instagram',
    clientIdEnv: ['SOCIAL_INSTAGRAM_CLIENT_ID', 'SOCIAL_INSTAGRAM_APP_ID', 'INSTAGRAM_CLIENT_ID', 'INSTAGRAM_APP_ID'],
    clientSecretEnv: ['SOCIAL_INSTAGRAM_CLIENT_SECRET', 'SOCIAL_INSTAGRAM_APP_SECRET', 'INSTAGRAM_CLIENT_SECRET', 'INSTAGRAM_APP_SECRET'],
    authUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scopes: [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
      'instagram_business_content_publish',
      'instagram_business_manage_insights'
    ],
    pkce: false,
    scopeSeparator: ',',
    forceReauth: true
  },
  threads: {
    id: 'threads',
    label: 'Threads',
    family: 'threads',
    clientIdEnv: ['SOCIAL_THREADS_CLIENT_ID', 'THREADS_CLIENT_ID', 'THREADS_APP_ID'],
    clientSecretEnv: ['SOCIAL_THREADS_CLIENT_SECRET', 'THREADS_CLIENT_SECRET', 'THREADS_APP_SECRET'],
    authUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    scopes: ['threads_basic', 'threads_content_publish'],
    pkce: false,
    scopeSeparator: ','
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    family: 'tiktok',
    clientIdEnv: ['SOCIAL_TIKTOK_CLIENT_KEY', 'SOCIAL_TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_TIKTOK_CLIENT_SECRET', 'TIKTOK_CLIENT_SECRET'],
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.upload', 'video.publish'],
    pkce: false,
    scopeSeparator: ',',
    clientIdParam: 'client_key'
  },
  reddit: {
    id: 'reddit',
    label: 'Reddit',
    family: 'reddit',
    clientIdEnv: ['SOCIAL_REDDIT_CLIENT_ID', 'REDDIT_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_REDDIT_CLIENT_SECRET', 'REDDIT_CLIENT_SECRET'],
    authUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    scopes: ['identity', 'submit', 'read', 'mysubreddits'],
    pkce: false,
    scopeSeparator: ' ',
    tokenAuth: 'basic',
    authParams: { duration: 'permanent' }
  },
  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    family: 'pinterest',
    clientIdEnv: ['SOCIAL_PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_PINTEREST_CLIENT_SECRET', 'PINTEREST_CLIENT_SECRET'],
    authUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    scopes: ['user_accounts:read', 'boards:read', 'pins:read', 'pins:write'],
    pkce: false,
    scopeSeparator: ',',
    tokenAuth: 'basic'
  },
  mastodon: {
    id: 'mastodon',
    label: 'Mastodon',
    family: 'mastodon',
    clientIdEnv: ['SOCIAL_MASTODON_CLIENT_ID', 'MASTODON_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_MASTODON_CLIENT_SECRET', 'MASTODON_CLIENT_SECRET'],
    instanceUrlEnv: ['SOCIAL_MASTODON_INSTANCE_URL', 'MASTODON_INSTANCE_URL'],
    authUrl: '',
    tokenUrl: '',
    scopes: ['read:accounts', 'write:statuses'],
    pkce: false,
    scopeSeparator: ' '
  },
  tumblr: {
    id: 'tumblr',
    label: 'Tumblr',
    family: 'tumblr',
    clientIdEnv: ['SOCIAL_TUMBLR_CLIENT_ID', 'SOCIAL_TUMBLR_CONSUMER_KEY', 'TUMBLR_CLIENT_ID', 'TUMBLR_CONSUMER_KEY'],
    clientSecretEnv: ['SOCIAL_TUMBLR_CLIENT_SECRET', 'SOCIAL_TUMBLR_CONSUMER_SECRET', 'TUMBLR_CLIENT_SECRET', 'TUMBLR_CONSUMER_SECRET'],
    authUrl: 'https://www.tumblr.com/oauth2/authorize',
    tokenUrl: 'https://api.tumblr.com/v2/oauth2/token',
    scopes: ['basic', 'write'],
    pkce: false,
    scopeSeparator: ' '
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    family: 'medium',
    clientIdEnv: ['SOCIAL_MEDIUM_CLIENT_ID', 'MEDIUM_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_MEDIUM_CLIENT_SECRET', 'MEDIUM_CLIENT_SECRET'],
    authUrl: 'https://medium.com/m/oauth/authorize',
    tokenUrl: 'https://api.medium.com/v1/tokens',
    scopes: ['basicProfile', 'publishPost'],
    pkce: false,
    scopeSeparator: ','
  },
  google: {
    id: 'google',
    label: 'Google APIs',
    family: 'google',
    clientIdEnv: ['SOCIAL_GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'],
    scopeEnv: ['SOCIAL_GOOGLE_SCOPES', 'GOOGLE_OAUTH_SCOPES'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: DEFAULT_GOOGLE_SCOPES,
    pkce: true,
    scopeSeparator: ' ',
    authParams: {
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent'
    }
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
const TOKEN_IMPORT_PROVIDER_IDS = new Set(['instagram', 'threads', 'mastodon']);

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

function getConfiguredScopes(config) {
  const configured = getEnvValue(config.scopeEnv || []);
  if (!configured) return config.scopes || [];
  return configured
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
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
  const scopes = getConfiguredScopes(config);
  const instanceUrl = getEnvValue(config.instanceUrlEnv || []).replace(/\/+$/, '');
  const authUrl = id === 'mastodon' && instanceUrl ? `${instanceUrl}/oauth/authorize` : config.authUrl;
  const tokenUrl = id === 'mastodon' && instanceUrl ? `${instanceUrl}/oauth/token` : config.tokenUrl;
  return {
    ...config,
    scopes,
    clientId: getEnvValue(config.clientIdEnv),
    clientSecret: getEnvValue(config.clientSecretEnv),
    configId: getEnvValue(config.configIdEnv || []),
    instanceUrl,
    apiBaseUrl: instanceUrl,
    authUrl,
    tokenUrl,
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
    'authorstudio://oauth',
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

function serializeOAuthParams(config, params) {
  const serialized = params.toString();
  if (config.family !== 'x') return serialized;

  return serialized.replace(/(^|&)scope=([^&]*)/, (match, prefix, scopeValue) => (
    `${prefix}scope=${scopeValue.replace(/\+/g, '%20')}`
  ));
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
    configured: Boolean(config.clientId && config.clientSecret && (config.id !== 'mastodon' || config.instanceUrl)),
    scopes: config.scopes,
    redirectUri: config.redirectUri
  };
}

function scopeSet(scopeValue = '') {
  return new Set(String(scopeValue || '')
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean));
}

function getMissingScopes(config, item) {
  if (!item) return [];
  const grantedScopes = scopeSet(item.scope || item.credentialArtifacts?.scope || '');
  return (config.scopes || []).filter((scope) => !grantedScopes.has(scope));
}

function providerSupportsRefresh(config) {
  return config.family === 'x'
    || config.family === 'instagram'
    || config.family === 'threads'
    || config.family === 'google';
}

function tokenNeedsRefresh(config, item) {
  if (!providerSupportsRefresh(config) || !item?.token) return false;
  const expiresAtMs = item.expiresAtMs ? Number(item.expiresAtMs) : null;
  if (!expiresAtMs) return false;
  return Date.now() + TOKEN_REFRESH_SKEW_MS >= expiresAtMs;
}

async function refreshStoredConnection(config, item) {
  const currentToken = decryptJson(item.token);

  let nextToken = null;
  if (config.family === 'x') {
    if (!currentToken?.refresh_token) return item;
    nextToken = await refreshXAccessToken(config, currentToken.refresh_token);
  } else if (config.family === 'google') {
    if (!currentToken?.refresh_token) return item;
    nextToken = await refreshGoogleAccessToken(config, currentToken.refresh_token);
  } else if (config.family === 'instagram') {
    if (!currentToken?.access_token) return item;
    nextToken = await refreshImportedInstagramToken(currentToken.access_token);
  } else if (config.family === 'threads') {
    if (!currentToken?.access_token) return item;
    nextToken = await refreshImportedThreadsToken(currentToken.access_token);
  } else {
    return item;
  }

  const mergedToken = {
    ...currentToken,
    ...nextToken,
    refresh_token: nextToken.refresh_token || currentToken.refresh_token,
    scope: nextToken.scope || currentToken.scope || config.scopes.join(' '),
    token_type: nextToken.token_type || currentToken.token_type || 'bearer'
  };
  const expiresInSeconds = Number(mergedToken.expires_in || 0);
  const refreshedAt = nowIso();
  const refreshedItem = {
    ...item,
    token: encryptJson(mergedToken),
    ...(item.selectedToken ? { selectedToken: encryptJson(mergedToken) } : {}),
    credentialArtifacts: summarizeTokenPayload(mergedToken, config),
    scope: String(mergedToken.scope || config.scopes.join(' ')),
    updatedAt: refreshedAt,
    tokenRefreshedAt: refreshedAt,
    expiresAtMs: expiresInSeconds > 0 ? Date.now() + (expiresInSeconds * 1000) : undefined
  };

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: refreshedItem
  }));

  return refreshedItem;
}

async function refreshConnectionIfNeeded(config, item) {
  if (!tokenNeedsRefresh(config, item)) return item;
  return refreshStoredConnection(config, item);
}

function toConnectionStatus(config, item) {
  const expiresAtMs = item?.expiresAtMs ? Number(item.expiresAtMs) : null;
  const expired = expiresAtMs ? Date.now() >= expiresAtMs : false;
  const selectedAccount = item?.selectedAccount || null;
  const needsSelection = Boolean(item && ['facebook', 'instagram', 'pinterest', 'tumblr'].includes(config.id) && !selectedAccount?.id);
  const missingScopes = getMissingScopes(config, item);
  const needsReconnect = Boolean(item && !expired && !needsSelection && missingScopes.length);
  const publicConfig = providerPublicConfig(config);
  const configured = Boolean(publicConfig.configured || item?.connectionMethod === 'token-import');
  return {
    ...publicConfig,
    configured,
    connected: Boolean(item && !expired && !needsSelection && !needsReconnect),
    status: !item ? 'not-connected' : expired ? 'expired' : needsSelection ? 'needs-selection' : needsReconnect ? 'needs-reconnect' : 'connected',
    needsReconnect,
    missingScopes,
    connectedAt: item?.connectedAt || null,
    updatedAt: item?.updatedAt || null,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    accountLabel: selectedAccount?.label || item?.accountLabel || '',
    selectedAccount,
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
  return Promise.all(Object.values(PROVIDERS).map(async (baseConfig) => {
    const config = getProviderConfig(baseConfig.id);
    let item = byProvider.get(config.id);
    try {
      item = await refreshConnectionIfNeeded(config, item);
    } catch {
      // Leave the stored status as-is; callers can reconnect if refresh fails.
    }
    return toConnectionStatus(config, item);
  }));
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
    [config.clientIdParam || 'client_id']: config.clientId,
    redirect_uri: config.redirectUri,
    state
  });

  if (config.configId) {
    params.set('config_id', config.configId);
  } else {
    params.set('scope', config.scopes.join(config.scopeSeparator || (config.family === 'meta' ? ',' : ' ')));
  }
  if (config.forceReauth) params.set('force_reauth', 'true');
  for (const [key, value] of Object.entries(config.authParams || {})) {
    params.set(key, value);
  }

  if (config.pkce) {
    params.set('code_challenge', codeChallenge(verifier));
    params.set('code_challenge_method', 'S256');
  }

  return {
    provider: config.id,
    label: config.label,
    authUrl: `${config.authUrl}?${serializeOAuthParams(config, params)}`,
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
  if (config.family === 'threads' && tokenPayload?.access_token && process.env.SOCIAL_THREADS_SKIP_LONG_LIVED_EXCHANGE !== 'true') {
    tokenPayload = await exchangeThreadsLongLivedToken(config, tokenPayload.access_token).catch(() => tokenPayload);
  }
  if (config.family === 'instagram' && tokenPayload?.access_token && process.env.SOCIAL_INSTAGRAM_SKIP_LONG_LIVED_EXCHANGE !== 'true') {
    const shortPayload = tokenPayload;
    tokenPayload = await exchangeInstagramLongLivedToken(config, tokenPayload.access_token)
      .then((longPayload) => ({
        ...shortPayload,
        ...longPayload,
        user_id: longPayload.user_id || shortPayload.user_id,
        scope: longPayload.scope || shortPayload.scope || config.scopes.join(' ')
      }))
      .catch(() => tokenPayload);
  }
  if (config.family === 'mastodon' && tokenPayload?.access_token && config.apiBaseUrl) {
    tokenPayload.instance_url = config.apiBaseUrl;
  }

  const expiresInSeconds = Number(tokenPayload?.expires_in || 0);
  const expiresAtMs = expiresInSeconds > 0 ? Date.now() + (expiresInSeconds * 1000) : null;
  const scope = String(tokenPayload?.scope || config.scopes.join(' '));
  const account = await fetchProviderProfile(config, tokenPayload?.access_token).catch(() => null)
    || (config.family === 'instagram' ? instagramProfileFromTokenPayload(tokenPayload) : null);
  const accountLabel = account?.label || await fetchAccountLabel(config, tokenPayload?.access_token).catch(() => '');
  const shouldAutoSelect = config.family === 'x'
    || config.family === 'linkedin'
    || config.family === 'instagram'
    || config.family === 'threads'
    || config.family === 'tiktok'
    || config.family === 'reddit'
    || config.family === 'mastodon'
    || config.family === 'medium'
    || config.family === 'google';

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: {
      ...connectionKey(stateItem.userSub, config.id),
      provider: config.id,
      providerFamily: config.family,
      username: stateItem.username || '',
      accountLabel,
      token: encryptJson(tokenPayload),
      selectedAccount: shouldAutoSelect ? account : undefined,
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

  let item = res?.Item;
  if (!item?.token) {
    const err = new Error(`${config.label} is not connected`);
    err.status = 404;
    throw err;
  }

  let expiresAtMs = item.expiresAtMs ? Number(item.expiresAtMs) : null;
  if (tokenNeedsRefresh(config, item)) {
    try {
      item = await refreshStoredConnection(config, item);
      expiresAtMs = item.expiresAtMs ? Number(item.expiresAtMs) : null;
    } catch (refreshErr) {
      if (expiresAtMs && Date.now() >= expiresAtMs) {
        const err = new Error(`${config.label} token refresh failed. Reconnect ${config.label} before posting.`);
        err.status = 409;
        err.details = { reason: refreshErr.message };
        throw err;
      }
    }
  }

  if (expiresAtMs && Date.now() >= expiresAtMs) {
    const err = new Error(`${config.label} token is expired`);
    err.status = 409;
    throw err;
  }

  const selectedAccount = item.selectedAccount || null;
  const encryptedToken = item.selectedToken || item.token;
  const providerFamily = item.providerFamily || config.family;
  if (['facebook', 'instagram', 'pinterest', 'tumblr'].includes(config.id) && !selectedAccount?.id) {
    const err = new Error(`${config.label} needs a selected account before posting`);
    err.status = 409;
    throw err;
  }

  return {
    provider: config.id,
    family: providerFamily,
    accountId: selectedAccount?.id || '',
    accountLabel: selectedAccount?.label || item.accountLabel || '',
    account: selectedAccount,
    scope: item.scope || '',
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    token: decryptJson(encryptedToken)
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

  if (config.family === 'threads') {
    return fetchJson(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
        code
      }).toString()
    });
  }

  if (config.family === 'tiktok') {
    return fetchJson(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
        code
      }).toString()
    });
  }

  if (config.tokenAuth === 'basic') {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    return fetchJson(config.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(config.family === 'reddit' ? { 'User-Agent': getRedditUserAgent() } : {})
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri
      }).toString()
    });
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId
  });
  if (verifier) params.set('code_verifier', verifier);
  if (['linkedin', 'instagram', 'mastodon', 'tumblr', 'medium', 'google'].includes(config.family)) params.set('client_secret', config.clientSecret);

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

async function refreshXAccessToken(config, refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (config.clientSecret) {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  return fetchJson(config.tokenUrl, {
    method: 'POST',
    headers,
    body: params.toString()
  });
}

async function refreshGoogleAccessToken(config, refreshToken) {
  return fetchJson(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret
    }).toString()
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

async function exchangeThreadsLongLivedToken(config, shortToken) {
  const url = new URL('https://graph.threads.net/access_token');
  url.searchParams.set('grant_type', 'th_exchange_token');
  url.searchParams.set('client_secret', config.clientSecret);
  url.searchParams.set('access_token', shortToken);
  return fetchJson(url.toString(), { method: 'GET' });
}

async function exchangeInstagramLongLivedToken(config, shortToken) {
  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', config.clientSecret);
  url.searchParams.set('access_token', shortToken);
  return fetchJson(url.toString(), { method: 'GET' });
}

function getRedditUserAgent() {
  return String(process.env.SOCIAL_REDDIT_USER_AGENT || 'web:grayson-wills-portfolio:v1.0 (by /u/graysonwills)').trim();
}

async function fetchAccountLabel(config, accessToken) {
  if (!accessToken) return '';
  let url = '';
  if (config.family === 'x') url = 'https://api.twitter.com/2/users/me?user.fields=username';
  if (config.family === 'linkedin') url = 'https://api.linkedin.com/v2/userinfo';
  if (config.family === 'meta') url = 'https://graph.facebook.com/v22.0/me?fields=id,name';
  if (config.family === 'instagram') url = 'https://graph.instagram.com/v23.0/me?fields=id,user_id,username,name';
  if (config.family === 'threads') url = 'https://graph.threads.net/v1.0/me?fields=id,username,name';
  if (config.family === 'tiktok') url = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name';
  if (config.family === 'reddit') url = 'https://oauth.reddit.com/api/v1/me';
  if (config.family === 'pinterest') url = 'https://api.pinterest.com/v5/user_account';
  if (config.family === 'mastodon') url = `${config.apiBaseUrl}/api/v1/accounts/verify_credentials`;
  if (config.family === 'tumblr') url = 'https://api.tumblr.com/v2/user/info';
  if (config.family === 'medium') url = 'https://api.medium.com/v1/me';
  if (config.family === 'google') url = 'https://openidconnect.googleapis.com/v1/userinfo';
  if (!url) return '';

  const payload = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(config.family === 'reddit' ? { 'User-Agent': getRedditUserAgent() } : {})
    }
  });

  if (config.family === 'x') return payload?.data?.username ? `@${payload.data.username}` : '';
  if (config.family === 'linkedin') return payload?.name || payload?.email || '';
  if (config.family === 'meta') return payload?.name || '';
  if (config.family === 'instagram') return payload?.username ? `@${payload.username}` : payload?.name || '';
  if (config.family === 'threads') return payload?.username ? `@${payload.username}` : payload?.name || '';
  if (config.family === 'tiktok') return payload?.data?.user?.display_name || payload?.data?.display_name || 'TikTok account';
  if (config.family === 'reddit') return payload?.name ? `u/${payload.name}` : 'Reddit account';
  if (config.family === 'pinterest') return payload?.username ? `@${payload.username}` : payload?.profile_url || 'Pinterest account';
  if (config.family === 'mastodon') return payload?.acct ? `@${payload.acct}` : payload?.display_name || 'Mastodon account';
  if (config.family === 'tumblr') return payload?.response?.user?.name || 'Tumblr account';
  if (config.family === 'medium') return payload?.data?.username ? `@${payload.data.username}` : payload?.data?.name || 'Medium account';
  if (config.family === 'google') return payload?.email || payload?.name || 'Google account';
  return '';
}

function instagramProfileFromTokenPayload(tokenPayload = {}) {
  const id = String(tokenPayload.user_id || tokenPayload.id || '').trim();
  if (!id) return null;
  const username = String(tokenPayload.username || '').trim();
  const handle = username ? `@${username.replace(/^@/, '')}` : '';
  return {
    id,
    label: handle || 'Instagram account',
    handle,
    platform: 'instagram',
    picture: ''
  };
}

function instagramProfileFromApiPayload(payload = {}, config = PROVIDERS.instagram) {
  const id = String(payload?.user_id || payload?.id || '').trim();
  if (!id) return null;
  const username = payload?.username ? `@${String(payload.username).replace(/^@/, '')}` : '';
  return {
    id,
    label: username || String(payload?.name || 'Instagram account'),
    handle: username,
    platform: config.id,
    picture: payload?.profile_picture_url || '',
    extra: {
      accountType: payload?.account_type || ''
    }
  };
}

async function fetchProviderProfile(config, accessToken) {
  if (!accessToken) return null;

  if (config.family === 'x') {
    const payload = await fetchJson('https://api.twitter.com/2/users/me?user.fields=username,profile_image_url,name', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const user = payload?.data || {};
    const username = user.username ? `@${user.username}` : '';
    return {
      id: String(user.id || ''),
      label: username || String(user.name || 'X account'),
      handle: username,
      platform: config.id,
      picture: user.profile_image_url || ''
    };
  }

  if (config.family === 'linkedin') {
    const payload = await fetchJson('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return {
      id: String(payload?.sub || ''),
      label: String(payload?.name || payload?.email || 'LinkedIn profile'),
      handle: payload?.email ? String(payload.email) : '',
      platform: config.id,
      picture: payload?.picture || ''
    };
  }

  if (config.family === 'meta') {
    const payload = await fetchJson('https://graph.facebook.com/v22.0/me?fields=id,name', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return {
      id: String(payload?.id || ''),
      label: String(payload?.name || 'Meta account'),
      handle: '',
      platform: config.id,
      picture: ''
    };
  }

  if (config.family === 'instagram') {
    const payload = await fetchJson('https://graph.instagram.com/v23.0/me?fields=id,user_id,username,name,profile_picture_url', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return instagramProfileFromApiPayload(payload, config);
  }

  if (config.family === 'threads') {
    const payload = await fetchJson('https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const username = payload?.username ? `@${payload.username}` : '';
    return {
      id: String(payload?.id || ''),
      label: username || String(payload?.name || 'Threads account'),
      handle: username,
      platform: config.id,
      picture: payload?.threads_profile_picture_url || ''
    };
  }

  if (config.family === 'tiktok') {
    const payload = await fetchJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const user = payload?.data?.user || payload?.data || {};
    return {
      id: String(user.open_id || ''),
      label: String(user.display_name || 'TikTok account'),
      handle: '',
      platform: config.id,
      picture: user.avatar_url || ''
    };
  }

  if (config.family === 'reddit') {
    const user = await fetchJson('https://oauth.reddit.com/api/v1/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': getRedditUserAgent()
      }
    });
    const username = String(user?.name || '').trim();
    return {
      id: username,
      label: username ? `u/${username}` : 'Reddit account',
      handle: username ? `u/${username}` : '',
      platform: config.id,
      picture: user?.icon_img || '',
      extra: {
        profileSubreddit: username ? `u_${username}` : ''
      }
    };
  }

  if (config.family === 'pinterest') {
    const user = await fetchJson('https://api.pinterest.com/v5/user_account', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const username = String(user?.username || '').trim();
    return {
      id: String(user?.account_id || username || user?.id || ''),
      label: username ? `@${username}` : String(user?.profile_url || 'Pinterest account'),
      handle: username ? `@${username}` : '',
      platform: config.id,
      picture: user?.profile_image || ''
    };
  }

  if (config.family === 'mastodon') {
    const user = await fetchJson(`${config.apiBaseUrl}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const acct = String(user?.acct || '').trim();
    return {
      id: String(user?.id || acct),
      label: acct ? `@${acct}` : String(user?.display_name || 'Mastodon account'),
      handle: acct ? `@${acct}` : '',
      platform: config.id,
      picture: user?.avatar || '',
      extra: {
        url: user?.url || '',
        instanceUrl: config.apiBaseUrl
      }
    };
  }

  if (config.family === 'tumblr') {
    const payload = await fetchJson('https://api.tumblr.com/v2/user/info', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const name = String(payload?.response?.user?.name || '').trim();
    return {
      id: name,
      label: name || 'Tumblr account',
      handle: name,
      platform: config.id,
      picture: ''
    };
  }

  if (config.family === 'medium') {
    const payload = await fetchJson('https://api.medium.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const user = payload?.data || {};
    const username = String(user.username || '').trim();
    return {
      id: String(user.id || username),
      label: username ? `@${username}` : String(user.name || 'Medium account'),
      handle: username ? `@${username}` : '',
      platform: config.id,
      picture: user.imageUrl || '',
      extra: {
        url: user.url || ''
      }
    };
  }

  if (config.family === 'google') {
    const payload = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return {
      id: String(payload?.sub || payload?.email || ''),
      label: String(payload?.email || payload?.name || 'Google account'),
      handle: payload?.email ? String(payload.email) : '',
      platform: config.id,
      picture: payload?.picture || '',
      extra: {
        hostedDomain: payload?.hd || ''
      }
    };
  }

  return null;
}

function normalizeGraphPicture(input) {
  return input?.data?.url || input?.url || '';
}

async function fetchMetaPages(accessToken) {
  const pages = [];
  let url = `https://graph.facebook.com/v22.0/me/accounts?fields=id,name,username,access_token,picture.type(large),instagram_business_account&limit=100&access_token=${encodeURIComponent(accessToken)}`;

  while (url) {
    const payload = await fetchJson(url);
    for (const page of payload?.data || []) {
      if (!page?.id || !page?.access_token) continue;
      pages.push({
        id: String(page.id),
        label: String(page.name || page.username || 'Facebook Page'),
        handle: page.username ? `@${page.username}` : '',
        platform: 'facebook',
        picture: normalizeGraphPicture(page.picture),
        tokenPayload: {
          access_token: page.access_token,
          token_type: 'Bearer'
        },
        extra: {
          instagramBusinessAccountId: page.instagram_business_account?.id || ''
        }
      });
    }
    url = payload?.paging?.next || '';
  }

  return pages;
}

async function fetchInstagramAccounts(accessToken) {
  const pages = await fetchMetaPages(accessToken);
  const accounts = [];

  for (const page of pages) {
    const igId = String(page?.extra?.instagramBusinessAccountId || '').trim();
    if (!igId) continue;

    let ig = {};
    try {
      ig = await fetchJson(
        `https://graph.facebook.com/v22.0/${encodeURIComponent(igId)}?fields=id,username,name,profile_picture_url&access_token=${encodeURIComponent(page.tokenPayload.access_token)}`
      );
    } catch {
      ig = {};
    }

    accounts.push({
      id: igId,
      label: String(ig.name || ig.username || 'Instagram account'),
      handle: ig.username ? `@${ig.username}` : '',
      platform: 'instagram',
      picture: ig.profile_picture_url || '',
      tokenPayload: {
        access_token: page.tokenPayload.access_token,
        token_type: 'Bearer'
      },
      extra: {
        facebookPageId: page.id,
        facebookPageLabel: page.label
      }
    });
  }

  return accounts;
}

async function fetchPinterestBoards(accessToken) {
  const boards = [];
  let url = 'https://api.pinterest.com/v5/boards?page_size=100';

  while (url) {
    const payload = await fetchJson(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    for (const board of payload?.items || []) {
      if (!board?.id) continue;
      boards.push({
        id: String(board.id),
        label: String(board.name || 'Pinterest board'),
        handle: board.url || '',
        platform: 'pinterest',
        picture: '',
        tokenPayload: {
          access_token: accessToken,
          token_type: 'Bearer'
        },
        extra: {
          privacy: board.privacy || '',
          url: board.url || ''
        }
      });
    }

    const bookmark = String(payload?.bookmark || '').trim();
    url = bookmark
      ? `https://api.pinterest.com/v5/boards?page_size=100&bookmark=${encodeURIComponent(bookmark)}`
      : '';
  }

  return boards;
}

async function fetchTumblrBlogs(accessToken) {
  const payload = await fetchJson('https://api.tumblr.com/v2/user/info', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return (payload?.response?.user?.blogs || [])
    .filter((blog) => blog?.name)
    .map((blog) => ({
      id: String(blog.uuid || blog.name),
      label: String(blog.title || blog.name || 'Tumblr blog'),
      handle: String(blog.name || ''),
      platform: 'tumblr',
      picture: '',
      tokenPayload: {
        access_token: accessToken,
        token_type: 'Bearer'
      },
      extra: {
        name: String(blog.name || ''),
        url: blog.url || ''
      }
    }));
}

async function validateInstagramAccessToken(accessToken, config = PROVIDERS.instagram) {
  const payload = await fetchJson('https://graph.instagram.com/v23.0/me?fields=id,user_id,username,name,account_type,profile_picture_url', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const account = instagramProfileFromApiPayload(payload, config);
  if (!account?.id) {
    const err = new Error('Instagram access token did not return a profile');
    err.status = 400;
    throw err;
  }
  return { payload, account };
}

async function refreshImportedInstagramToken(accessToken) {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', accessToken);
  return fetchJson(url.toString(), { method: 'GET' });
}

async function refreshImportedThreadsToken(accessToken) {
  const url = new URL('https://graph.threads.net/refresh_access_token');
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', accessToken);
  return fetchJson(url.toString(), { method: 'GET' });
}

function normalizeMastodonInstanceUrl(value = '') {
  const safeValue = String(value || '').trim().replace(/\/+$/, '');
  if (!safeValue) return '';
  let url = null;
  try {
    url = new URL(safeValue);
  } catch {
    const err = new Error('Mastodon instance URL must be a valid HTTPS URL');
    err.status = 400;
    throw err;
  }
  if (url.protocol !== 'https:') {
    const err = new Error('Mastodon instance URL must use HTTPS');
    err.status = 400;
    throw err;
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function configForTokenImport(config, { instanceUrl = '' } = {}) {
  if (config.id !== 'mastodon') return config;
  const normalizedInstanceUrl = normalizeMastodonInstanceUrl(instanceUrl || config.instanceUrl);
  if (!normalizedInstanceUrl) {
    const err = new Error('Mastodon instance URL is required when importing a token');
    err.status = 400;
    throw err;
  }
  return {
    ...config,
    instanceUrl: normalizedInstanceUrl,
    apiBaseUrl: normalizedInstanceUrl,
    authUrl: `${normalizedInstanceUrl}/oauth/authorize`,
    tokenUrl: `${normalizedInstanceUrl}/oauth/token`
  };
}

async function validateImportedToken(config, accessToken) {
  if (config.id === 'instagram') return validateInstagramAccessToken(accessToken, config);

  const account = await fetchProviderProfile(config, accessToken);
  if (!account?.id) {
    const err = new Error(`${config.label} access token did not return a profile`);
    err.status = 400;
    throw err;
  }
  return { payload: null, account };
}

async function maybeRefreshImportedToken(config, accessToken) {
  if (config.id === 'instagram') return refreshImportedInstagramToken(accessToken).catch(() => null);
  if (config.id === 'threads') return refreshImportedThreadsToken(accessToken).catch(() => null);
  return null;
}

async function importProviderToken(provider, user, { accessToken, instanceUrl = '' } = {}) {
  const baseConfig = getProviderConfig(provider);
  if (!TOKEN_IMPORT_PROVIDER_IDS.has(baseConfig.id)) {
    const err = new Error('Token import is only supported for Instagram, Threads, and Mastodon');
    err.status = 400;
    throw err;
  }
  const config = configForTokenImport(baseConfig, { instanceUrl });

  const safeAccessToken = String(accessToken || '').trim();
  if (!safeAccessToken || safeAccessToken.length < 20) {
    const err = new Error(`${config.label} access token is required`);
    err.status = 400;
    throw err;
  }

  const { account } = await validateImportedToken(config, safeAccessToken);
  const refreshed = await maybeRefreshImportedToken(config, safeAccessToken);
  const tokenPayload = {
    access_token: refreshed?.access_token || safeAccessToken,
    token_type: String(refreshed?.token_type || 'Bearer'),
    scope: config.scopes.join(' '),
    imported: true,
    ...(config.id === 'mastodon' ? { instance_url: config.apiBaseUrl } : {}),
    ...(refreshed?.expires_in ? { expires_in: refreshed.expires_in } : {})
  };
  const expiresInSeconds = Number(tokenPayload.expires_in || 0);
  const expiresAtMs = expiresInSeconds > 0 ? Date.now() + (expiresInSeconds * 1000) : null;
  const userSub = userKey(user);

  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: {
      ...connectionKey(userSub, config.id),
      provider: config.id,
      providerFamily: config.family,
      connectionMethod: 'token-import',
      username: usernameForUser(user),
      accountLabel: account.label,
      token: encryptJson(tokenPayload),
      selectedAccount: account,
      credentialArtifacts: summarizeTokenPayload(tokenPayload, config),
      scope: tokenPayload.scope,
      connectedAt: nowIso(),
      updatedAt: nowIso(),
      expiresAtMs: expiresAtMs || undefined
    }
  }));

  return {
    provider: config.id,
    selectedAccount: account,
    accountLabel: account.label,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    refreshed: Boolean(refreshed?.access_token)
  };
}

async function getConnectedProviderItem(config, user) {
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

  return item;
}

async function listProviderAccounts(provider, user) {
  const config = getProviderConfig(provider);
  const item = await getConnectedProviderItem(config, user);
  const tokenPayload = decryptJson(item.token);
  const accessToken = tokenPayload?.access_token;
  if (!accessToken) {
    const err = new Error(`${config.label} did not store an access token`);
    err.status = 409;
    throw err;
  }

  let accounts = [];
  if (['x', 'linkedin', 'instagram', 'threads', 'tiktok', 'reddit', 'mastodon', 'medium', 'google'].includes(config.family)) {
    const profile = item.selectedAccount
      || await fetchProviderProfile(config, accessToken).catch(() => null)
      || (config.family === 'instagram' ? instagramProfileFromTokenPayload(tokenPayload) : null);
    accounts = profile?.id ? [{ ...profile, tokenPayload }] : [];
  } else if (config.id === 'facebook') {
    accounts = await fetchMetaPages(accessToken);
  } else if (config.id === 'pinterest') {
    accounts = await fetchPinterestBoards(accessToken);
  } else if (config.id === 'tumblr') {
    accounts = await fetchTumblrBlogs(accessToken);
  } else if (config.id === 'instagram') {
    accounts = await fetchInstagramAccounts(accessToken);
  }

  return {
    provider: config.id,
    accounts: accounts.map(({ tokenPayload: _tokenPayload, ...account }) => account),
    selectedAccount: item.selectedAccount || null
  };
}

async function selectProviderAccount(provider, user, { accountId } = {}) {
  const config = getProviderConfig(provider);
  const safeAccountId = String(accountId || '').trim();
  if (!safeAccountId) {
    const err = new Error('accountId is required');
    err.status = 400;
    throw err;
  }

  const item = await getConnectedProviderItem(config, user);
  const tokenPayload = decryptJson(item.token);
  const accessToken = tokenPayload?.access_token;
  if (!accessToken) {
    const err = new Error(`${config.label} did not store an access token`);
    err.status = 409;
    throw err;
  }

  let accounts = [];
  if (['x', 'linkedin', 'instagram', 'threads', 'tiktok', 'reddit', 'mastodon', 'medium', 'google'].includes(config.family)) {
    const profile = item.selectedAccount
      || await fetchProviderProfile(config, accessToken).catch(() => null)
      || (config.family === 'instagram' ? instagramProfileFromTokenPayload(tokenPayload) : null);
    accounts = profile?.id ? [{ ...profile, tokenPayload }] : [];
  } else if (config.id === 'facebook') {
    accounts = await fetchMetaPages(accessToken);
  } else if (config.id === 'pinterest') {
    accounts = await fetchPinterestBoards(accessToken);
  } else if (config.id === 'tumblr') {
    accounts = await fetchTumblrBlogs(accessToken);
  } else if (config.id === 'instagram') {
    accounts = await fetchInstagramAccounts(accessToken);
  }

  const selected = accounts.find((account) => String(account.id) === safeAccountId);
  if (!selected) {
    const err = new Error('Selected account is not available for this provider');
    err.status = 404;
    throw err;
  }

  const { tokenPayload: selectedTokenPayload, ...selectedAccount } = selected;
  const selectedToken = selectedTokenPayload ? encryptJson(selectedTokenPayload) : undefined;
  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: {
      ...item,
      selectedAccount,
      selectedToken,
      accountLabel: selectedAccount.label || item.accountLabel || '',
      updatedAt: nowIso()
    }
  }));

  return {
    provider: config.id,
    selectedAccount
  };
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
  userKey,
  normalizeProviderId,
  getProviderConfig,
  getProviderStatus,
  startOAuth,
  completeOAuth,
  importProviderToken,
  disconnectProvider,
  listProviderAccounts,
  selectProviderAccount,
  getPostingCredential,
  normalizeReturnUrl,
  providerPublicConfig,
  summarizeTokenPayload,
  buildOAuthReturnUrl
};
