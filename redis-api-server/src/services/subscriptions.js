const { PutCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { getDdbDoc, getSes } = require('./aws/clients');
const { sha256Hex, randomToken, normalizeEmail, maskEmail } = require('../utils/crypto');
const { buildConfirmEmail, buildSubscribedEmail, buildUnsubscribedEmail } = require('./email/templates');

const DEFAULT_SUBSCRIBERS_TABLE = 'portfolio-email-subscribers';
const DEFAULT_TOKENS_TABLE = 'portfolio-email-tokens';

const DEFAULT_ALLOWED_TOPICS = ['blog_posts', 'major_updates'];

function getConfig() {
  return {
    subscribersTable: process.env.SUBSCRIBERS_TABLE_NAME || DEFAULT_SUBSCRIBERS_TABLE,
    tokensTable: process.env.TOKENS_TABLE_NAME || DEFAULT_TOKENS_TABLE,
    publicSiteUrl: (process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, ''),
    emailBrandLogoUrl: String(process.env.EMAIL_BRAND_LOGO_URL || '').trim() || `${(process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, '')}/favicon.png`,
    sesFromEmail: process.env.SES_FROM_EMAIL || '',
    allowedTopics: (process.env.SUBSCRIBE_ALLOWED_TOPICS
      ? process.env.SUBSCRIBE_ALLOWED_TOPICS.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_ALLOWED_TOPICS),
  };
}

function isValidEmail(email) {
  const e = String(email || '').trim();
  // Pragmatic validation; defer final validation to SES.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function sanitizeTopics(requested, allowedTopics) {
  const list = Array.isArray(requested) ? requested : [];
  const clean = list.map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
  const allowed = new Set(allowedTopics);
  const filtered = clean.filter(t => allowed.has(t));
  return filtered.length ? filtered : ['blog_posts'];
}

async function sendSesEmail({ to, subject, text, html }) {
  const { sesFromEmail } = getConfig();
  if (!sesFromEmail) {
    throw new Error('SES_FROM_EMAIL not configured');
  }

  const ses = getSes();
  const cmd = new SendEmailCommand({
    FromEmailAddress: sesFromEmail,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: text, Charset: 'UTF-8' },
          Html: { Data: html, Charset: 'UTF-8' }
        }
      }
    }
  });

  return await ses.send(cmd);
}

async function createToken({ emailHash, action, ttlSeconds }) {
  const cfg = getConfig();
  const ddb = getDdbDoc();

  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const nowIso = new Date().toISOString();
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + (ttlSeconds || 24 * 60 * 60);

  await ddb.send(new PutCommand({
    TableName: cfg.tokensTable,
    Item: {
      tokenHash,
      emailHash,
      action,
      expiresAtEpoch,
      createdAt: nowIso
    }
  }));

  return token;
}

async function getSubscriberEmail(emailHash) {
  const cfg = getConfig();
  const ddb = getDdbDoc();

  const res = await ddb.send(new GetCommand({
    TableName: cfg.subscribersTable,
    Key: { emailHash }
  }));

  const email = res?.Item?.email || null;
  return email ? String(email).toLowerCase() : null;
}

async function requestSubscription({ email, topics, source, consentIp, consentUserAgent }) {
  const cfg = getConfig();
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    const err = new Error('Invalid email address');
    err.status = 400;
    throw err;
  }

  const topicList = sanitizeTopics(topics, cfg.allowedTopics);

  const emailHash = sha256Hex(normalized);
  const nowIso = new Date().toISOString();
  const ddb = getDdbDoc();

  // Prevent duplicate signups + duplicate confirmation sends.
  // Table primary key is emailHash, so this is the single source of truth per email.
  const existingRes = await ddb.send(new GetCommand({
    TableName: cfg.subscribersTable,
    Key: { emailHash },
    ProjectionExpression: '#status',
    ExpressionAttributeNames: { '#status': 'status' }
  }));
  const existingStatus = String(existingRes?.Item?.status || '').toUpperCase();
  if (existingStatus === 'SUBSCRIBED') {
    return {
      ok: true,
      status: 'ALREADY_SUBSCRIBED',
      alreadySubscribed: true,
      message: 'This email is already subscribed.'
    };
  }
  if (existingStatus === 'PENDING') {
    return {
      ok: true,
      status: 'ALREADY_PENDING',
      alreadyPending: true,
      message: 'A confirmation email has already been sent. Please check your inbox.'
    };
  }

  // Upsert subscriber as PENDING. Don't overwrite unsubscribed/confirmed timestamps.
  await ddb.send(new UpdateCommand({
    TableName: cfg.subscribersTable,
    Key: { emailHash },
    UpdateExpression: [
      'SET #email = if_not_exists(#email, :email)',
      '#status = :pending',
      '#topics = :topics',
      '#source = :source',
      '#updatedAt = :now',
      '#createdAt = if_not_exists(#createdAt, :now)',
      '#consentVersion = :consentVersion',
      '#consentIp = :consentIp',
      '#consentUserAgent = :consentUa'
    ].join(', '),
    ExpressionAttributeNames: {
      '#email': 'email',
      '#status': 'status',
      '#topics': 'topics',
      '#source': 'source',
      '#updatedAt': 'updatedAt',
      '#createdAt': 'createdAt',
      '#consentVersion': 'consentVersion',
      '#consentIp': 'consentIp',
      '#consentUserAgent': 'consentUserAgent'
    },
    ExpressionAttributeValues: {
      ':email': normalized,
      ':pending': 'PENDING',
      ':topics': topicList,
      ':source': source || 'unknown',
      ':now': nowIso,
      ':consentVersion': 'v1',
      ':consentIp': consentIp || null,
      ':consentUa': consentUserAgent || null
    }
  }));

  // Create confirm token (24h TTL)
  const token = await createToken({ emailHash, action: 'confirm', ttlSeconds: 24 * 60 * 60 });

  const confirmUrl = `${cfg.publicSiteUrl}/notifications/confirm?token=${encodeURIComponent(token)}`;
  const { subject, text, html } = buildConfirmEmail({
    confirmUrl,
    brandLogoUrl: cfg.emailBrandLogoUrl
  });

  try {
    await sendSesEmail({ to: normalized, subject, text, html });
  } catch (err) {
    console.error('[subscriptions] SES send failed:', {
      to: maskEmail(normalized),
      message: String(err?.message || err)
    });

    const raw = String(err?.message || '');
    if (/not verified/i.test(raw)) {
      const e = new Error('Email address is not verified. SES is in sandbox; verify your recipient email in SES or request production access.');
      e.status = 400;
      throw e;
    }

    const e = new Error('Unable to send confirmation email at this time');
    e.status = 502;
    throw e;
  }

  return { ok: true };
}

async function confirmSubscription({ token }) {
  const cfg = getConfig();
  const raw = String(token || '').trim();
  if (!raw) {
    const err = new Error('Missing token');
    err.status = 400;
    throw err;
  }

  const tokenHash = sha256Hex(raw);
  const ddb = getDdbDoc();
  const tokenRes = await ddb.send(new GetCommand({
    TableName: cfg.tokensTable,
    Key: { tokenHash }
  }));

  const tokenItem = tokenRes?.Item;
  if (!tokenItem || tokenItem.action !== 'confirm') {
    const err = new Error('Invalid or expired token');
    err.status = 400;
    throw err;
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (typeof tokenItem.expiresAtEpoch === 'number' && nowEpoch > tokenItem.expiresAtEpoch) {
    // Best-effort cleanup
    await ddb.send(new DeleteCommand({ TableName: cfg.tokensTable, Key: { tokenHash } }));
    const err = new Error('Token expired');
    err.status = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: cfg.subscribersTable,
    Key: { emailHash: tokenItem.emailHash },
    UpdateExpression: [
      'SET #status = :subscribed',
      '#confirmedAt = if_not_exists(#confirmedAt, :now)',
      '#updatedAt = :now'
    ].join(', '),
    ExpressionAttributeNames: {
      '#status': 'status',
      '#confirmedAt': 'confirmedAt',
      '#updatedAt': 'updatedAt'
    },
    ExpressionAttributeValues: {
      ':subscribed': 'SUBSCRIBED',
      ':now': nowIso
    }
  }));

  // Single-use confirm token
  await ddb.send(new DeleteCommand({ TableName: cfg.tokensTable, Key: { tokenHash } }));

  // Best-effort: send a "subscribed" confirmation email.
  try {
    const email = await getSubscriberEmail(tokenItem.emailHash);
    if (email) {
      const unsubToken = await createToken({
        emailHash: tokenItem.emailHash,
        action: 'unsubscribe',
        ttlSeconds: 30 * 24 * 60 * 60
      });
      const unsubscribeUrl = `${cfg.publicSiteUrl}/notifications/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      const blogUrl = `${cfg.publicSiteUrl}/blog`;
      const { subject, text, html } = buildSubscribedEmail({
        blogUrl,
        unsubscribeUrl,
        brandLogoUrl: cfg.emailBrandLogoUrl
      });
      await sendSesEmail({ to: email, subject, text, html });
    }
  } catch (err) {
    console.error('[subscriptions] Subscribed email failed:', { message: String(err?.message || err) });
  }

  return { ok: true, status: 'SUBSCRIBED' };
}

async function unsubscribe({ token }) {
  const cfg = getConfig();
  const raw = String(token || '').trim();
  if (!raw) {
    const err = new Error('Missing token');
    err.status = 400;
    throw err;
  }

  const tokenHash = sha256Hex(raw);
  const ddb = getDdbDoc();
  const tokenRes = await ddb.send(new GetCommand({
    TableName: cfg.tokensTable,
    Key: { tokenHash }
  }));

  const tokenItem = tokenRes?.Item;
  if (!tokenItem || (tokenItem.action !== 'unsubscribe' && tokenItem.action !== 'manage')) {
    const err = new Error('Invalid or expired token');
    err.status = 400;
    throw err;
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (typeof tokenItem.expiresAtEpoch === 'number' && nowEpoch > tokenItem.expiresAtEpoch) {
    await ddb.send(new DeleteCommand({ TableName: cfg.tokensTable, Key: { tokenHash } }));
    const err = new Error('Token expired');
    err.status = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: cfg.subscribersTable,
    Key: { emailHash: tokenItem.emailHash },
    UpdateExpression: [
      'SET #status = :unsub',
      '#unsubscribedAt = :now',
      '#updatedAt = :now'
    ].join(', '),
    ExpressionAttributeNames: {
      '#status': 'status',
      '#unsubscribedAt': 'unsubscribedAt',
      '#updatedAt': 'updatedAt'
    },
    ExpressionAttributeValues: {
      ':unsub': 'UNSUBSCRIBED',
      ':now': nowIso
    }
  }));

  await ddb.send(new DeleteCommand({ TableName: cfg.tokensTable, Key: { tokenHash } }));

  // Best-effort: send unsubscribe confirmation.
  try {
    const email = await getSubscriberEmail(tokenItem.emailHash);
    if (email) {
      const blogUrl = `${cfg.publicSiteUrl}/blog`;
      const resubscribeUrl = blogUrl;
      const { subject, text, html } = buildUnsubscribedEmail({
        resubscribeUrl,
        blogUrl,
        brandLogoUrl: cfg.emailBrandLogoUrl
      });
      await sendSesEmail({ to: email, subject, text, html });
    }
  } catch (err) {
    console.error('[subscriptions] Unsubscribed email failed:', { message: String(err?.message || err) });
  }

  return { ok: true, status: 'UNSUBSCRIBED' };
}

async function updatePreferences({ token, topics }) {
  const cfg = getConfig();
  const raw = String(token || '').trim();
  if (!raw) {
    const err = new Error('Missing token');
    err.status = 400;
    throw err;
  }

  const topicList = sanitizeTopics(topics, cfg.allowedTopics);

  const tokenHash = sha256Hex(raw);
  const ddb = getDdbDoc();
  const tokenRes = await ddb.send(new GetCommand({
    TableName: cfg.tokensTable,
    Key: { tokenHash }
  }));

  const tokenItem = tokenRes?.Item;
  if (!tokenItem || tokenItem.action !== 'manage') {
    const err = new Error('Invalid or expired token');
    err.status = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: cfg.subscribersTable,
    Key: { emailHash: tokenItem.emailHash },
    UpdateExpression: [
      'SET #topics = :topics',
      '#updatedAt = :now'
    ].join(', '),
    ExpressionAttributeNames: {
      '#topics': 'topics',
      '#updatedAt': 'updatedAt'
    },
    ExpressionAttributeValues: {
      ':topics': topicList,
      ':now': nowIso
    }
  }));

  return { ok: true };
}

module.exports = {
  requestSubscription,
  confirmSubscription,
  unsubscribe,
  updatePreferences,
  getConfig,
};
