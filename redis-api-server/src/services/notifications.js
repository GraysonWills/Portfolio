const { ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { CreateScheduleCommand, DeleteScheduleCommand } = require('@aws-sdk/client-scheduler');

const redisClient = require('../config/redis');
const { getContentWhere, addToIndex } = require('../utils/content-index');
const { getDdbDoc, getSes, getScheduler, getAwsRegion } = require('./aws/clients');
const { isContentDdbEnabled, ddbGetContentByListItemId, ddbPutContent } = require('./content-ddb');
const { sha256Hex, randomToken, maskEmail } = require('../utils/crypto');
const { buildNewPostEmail } = require('./email/templates');

const DEFAULT_SUBSCRIBERS_TABLE = 'portfolio-email-subscribers';
const DEFAULT_TOKENS_TABLE = 'portfolio-email-tokens';
const DEFAULT_SCHEDULE_GROUP = 'portfolio-email';

const CONTENT_BACKEND = String(process.env.CONTENT_BACKEND || 'redis').toLowerCase();
const useDdbAsPrimary = CONTENT_BACKEND === 'dynamodb' || CONTENT_BACKEND === 'ddb';

function getConfig() {
  return {
    subscribersTable: process.env.SUBSCRIBERS_TABLE_NAME || DEFAULT_SUBSCRIBERS_TABLE,
    tokensTable: process.env.TOKENS_TABLE_NAME || DEFAULT_TOKENS_TABLE,
    publicSiteUrl: (process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, ''),
    sesFromEmail: process.env.SES_FROM_EMAIL || '',
    schedulerGroupName: process.env.SCHEDULER_GROUP_NAME || DEFAULT_SCHEDULE_GROUP,
    schedulerInvokeRoleArn: process.env.SCHEDULER_INVOKE_ROLE_ARN || '',
    schedulerTargetLambdaArn: process.env.SCHEDULER_TARGET_LAMBDA_ARN || '',
    emailNotificationsEnabled: process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'false',
    emailSendAllowlist: process.env.EMAIL_SEND_ALLOWLIST
      ? process.env.EMAIL_SEND_ALLOWLIST.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : null,
  };
}

function toAtExpression(date) {
  // Scheduler expects: at(yyyy-mm-ddThh:mm:ss)
  const iso = new Date(date).toISOString(); // yyyy-mm-ddThh:mm:ss.sssZ
  const noMs = iso.replace(/\.\d{3}Z$/, '');
  const local = noMs.replace(/Z$/, '');
  return `at(${local})`;
}

function safeScheduleName(listItemID) {
  const hash = sha256Hex(String(listItemID || '')).slice(0, 12);
  const ts = Date.now();
  return `blog-${hash}-${ts}`.slice(0, 64);
}

async function setRedisDocument(contentId, doc) {
  const key = `content:${contentId}`;
  try {
    await redisClient.json.set(key, '$', doc);
  } catch (err) {
    await redisClient.set(key, JSON.stringify(doc));
  }
  await addToIndex(contentId);
}

async function setContentDocument(doc) {
  if (useDdbAsPrimary) {
    await ddbPutContent(doc);
    return;
  }

  await setRedisDocument(doc.ID, doc);
  if (isContentDdbEnabled()) {
    // Keep multi-region DR store in sync.
    await ddbPutContent(doc);
  }
}

async function getBlogGroup(listItemID) {
  if (useDdbAsPrimary) {
    return (await ddbGetContentByListItemId(listItemID)) || [];
  }

  try {
    const items = await getContentWhere((item) => item.ListItemID === listItemID);
    return items || [];
  } catch (err) {
    if (isContentDdbEnabled()) {
      return (await ddbGetContentByListItemId(listItemID)) || [];
    }
    throw err;
  }
}

function extractBlogMetadata(items) {
  const metaItem = items.find(i => i.PageContentID === 3 && i.Metadata) || items.find(i => i.Metadata);
  const meta = (metaItem && metaItem.Metadata && typeof metaItem.Metadata === 'object') ? metaItem.Metadata : {};
  const title = meta.title || 'Untitled';
  const summary = meta.summary || '';
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const publishDate = meta.publishDate ? new Date(meta.publishDate) : null;
  const status = meta.status || 'published';
  const scheduleName = meta.scheduleName || null;
  return { metaItem, meta, title, summary, tags, publishDate, status, scheduleName };
}

function hasBlogContent(items) {
  return items.some((i) => (i.PageContentID === 13 || i.PageContentID === 4) && typeof i.Text === 'string' && i.Text.trim());
}

function extractBlogHeroImage(items) {
  const img = items.find((i) => i.PageContentID === 5 && typeof i.Photo === 'string' && i.Photo.trim())
    || items.find((i) => typeof i.Photo === 'string' && i.Photo.trim());
  const url = img ? String(img.Photo).trim() : '';
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null; // don't embed data URLs in email
  return url;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateReadTimeMinutesFromItems(items) {
  const body = items.find((i) => i.PageContentID === 13 && typeof i.Text === 'string' && i.Text.trim())
    || items.find((i) => i.PageContentID === 4 && typeof i.Text === 'string' && i.Text.trim());

  const text = stripHtml(body?.Text || '');
  if (!text) return null;
  const words = text.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return minutes;
}

async function assertBlogPostExists(listItemID) {
  const items = await getBlogGroup(listItemID);
  if (!items.length || !hasBlogContent(items)) {
    const err = new Error('Blog post not found');
    err.status = 404;
    throw err;
  }
  return items;
}

async function ensureBlogItemMetadataRecord(listItemID, fallbackMeta = {}) {
  const items = await getBlogGroup(listItemID);
  const existing = items.find(i => i.PageContentID === 3);
  if (existing) return existing;

  const id = `blog-item-${String(listItemID || '').trim()}`;
  const nowIso = new Date().toISOString();
  const doc = {
    ID: id,
    Text: '',
    ListItemID: listItemID,
    PageID: 3,
    PageContentID: 3,
    Metadata: fallbackMeta,
    CreatedAt: nowIso,
    UpdatedAt: nowIso
  };

  await setContentDocument(doc);
  return doc;
}

async function updateBlogMetadata(listItemID, patch) {
  const items = await getBlogGroup(listItemID);
  const metaCandidate = items.find(i => i.PageContentID === 3) || items.find(i => i.Metadata);
  const baseMeta = (metaCandidate?.Metadata && typeof metaCandidate.Metadata === 'object') ? metaCandidate.Metadata : {};

  const blogItem = items.find(i => i.PageContentID === 3) || await ensureBlogItemMetadataRecord(listItemID, baseMeta);
  const next = {
    ...(blogItem || {}),
    ID: blogItem.ID,
    ListItemID: listItemID,
    PageID: 3,
    PageContentID: 3,
    Metadata: { ...(baseMeta || {}), ...(patch || {}) },
    UpdatedAt: new Date().toISOString()
  };

  await setContentDocument(next);
  return next;
}

async function sendNewPostEmail({ to, title, summary, postUrl, unsubscribeUrl, imageUrl, tags, readTimeMinutes }) {
  const cfg = getConfig();
  if (!cfg.sesFromEmail) throw new Error('SES_FROM_EMAIL not configured');

  const { subject, text, html } = buildNewPostEmail({
    title,
    summary,
    postUrl,
    unsubscribeUrl,
    imageUrl,
    tags,
    readTimeMinutes
  });

  const ses = getSes();
  const cmd = new SendEmailCommand({
    FromEmailAddress: cfg.sesFromEmail,
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

async function listSubscribedRecipients({ topic = 'blog_posts' } = {}) {
  const cfg = getConfig();
  const ddb = getDdbDoc();

  const out = [];
  let ExclusiveStartKey = undefined;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: cfg.subscribersTable,
      ExclusiveStartKey,
      FilterExpression: '#status = :s AND (attribute_not_exists(#topics) OR contains(#topics, :t))',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#topics': 'topics'
      },
      ExpressionAttributeValues: {
        ':s': 'SUBSCRIBED',
        ':t': topic
      },
      ProjectionExpression: 'emailHash, email, topics, status'
    }));

    if (Array.isArray(res?.Items)) out.push(...res.Items);
    ExclusiveStartKey = res?.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // Optional safety gate
  const allow = cfg.emailSendAllowlist;
  if (allow && allow.length) {
    return out.filter(r => allow.includes(String(r.email || '').toLowerCase()));
  }

  return out;
}

async function createUnsubscribeToken(emailHash) {
  const cfg = getConfig();
  const ddb = getDdbDoc();

  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const nowIso = new Date().toISOString();
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

  await ddb.send(new PutCommand({
    TableName: cfg.tokensTable,
    Item: {
      tokenHash,
      emailHash,
      action: 'unsubscribe',
      expiresAtEpoch,
      createdAt: nowIso
    }
  }));

  return token;
}

async function sendBlogPostNotification({ listItemID, topic = 'blog_posts' }) {
  const cfg = getConfig();
  if (!cfg.emailNotificationsEnabled) {
    return { ok: true, skipped: true, reason: 'EMAIL_NOTIFICATIONS_ENABLED=false' };
  }

  const items = await assertBlogPostExists(listItemID);

  const { title, summary, tags } = extractBlogMetadata(items);
  const imageUrl = extractBlogHeroImage(items);
  const readTimeMinutes = estimateReadTimeMinutesFromItems(items);
  const postUrl = `${cfg.publicSiteUrl}/blog/${encodeURIComponent(listItemID)}`;

  const recipients = await listSubscribedRecipients({ topic });
  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    const email = String(r.email || '').toLowerCase();
    if (!email) continue;

    try {
      const unsubToken = await createUnsubscribeToken(r.emailHash);
      const unsubscribeUrl = `${cfg.publicSiteUrl}/notifications/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      await sendNewPostEmail({
        to: email,
        title,
        summary,
        postUrl,
        unsubscribeUrl,
        imageUrl,
        tags,
        readTimeMinutes
      });
      sent++;
    } catch (err) {
      failed++;
      console.error('[notifications] Send failed:', {
        to: maskEmail(email),
        message: String(err?.message || err)
      });
    }
  }

  return { ok: true, sent, failed, total: recipients.length };
}

async function schedulePublish({ listItemID, publishAt, sendEmail = true, topic = 'blog_posts' }) {
  const cfg = getConfig();
  if (!cfg.schedulerInvokeRoleArn) {
    const err = new Error('SCHEDULER_INVOKE_ROLE_ARN not configured');
    err.status = 500;
    throw err;
  }
  if (!cfg.schedulerTargetLambdaArn) {
    const err = new Error('SCHEDULER_TARGET_LAMBDA_ARN not configured');
    err.status = 500;
    throw err;
  }

  const runAt = new Date(publishAt);
  if (Number.isNaN(runAt.getTime())) {
    const err = new Error('Invalid publishAt date');
    err.status = 400;
    throw err;
  }

  const existingItems = await assertBlogPostExists(listItemID);

  // Best-effort cleanup for reschedules.
  try {
    const existingMeta = extractBlogMetadata(existingItems);
    if (existingMeta.scheduleName) {
      const scheduler = getScheduler();
      await scheduler.send(new DeleteScheduleCommand({
        Name: existingMeta.scheduleName,
        GroupName: cfg.schedulerGroupName
      }));
    }
  } catch {
    // ignore
  }

  const name = safeScheduleName(listItemID);
  const input = {
    kind: 'publish_blog_post',
    listItemID,
    sendEmail: !!sendEmail,
    topic
  };

  const scheduler = getScheduler();
  await scheduler.send(new CreateScheduleCommand({
    Name: name,
    GroupName: cfg.schedulerGroupName,
    FlexibleTimeWindow: { Mode: 'OFF' },
    ScheduleExpression: toAtExpression(runAt),
    ScheduleExpressionTimezone: 'UTC',
    ActionAfterCompletion: 'DELETE',
    Target: {
      Arn: cfg.schedulerTargetLambdaArn,
      RoleArn: cfg.schedulerInvokeRoleArn,
      Input: JSON.stringify(input)
    }
  }));

  // Store schedule name on blog metadata so the authoring tool can cancel/reschedule.
  await updateBlogMetadata(listItemID, {
    status: 'scheduled',
    publishDate: runAt.toISOString(),
    scheduleName: name,
    notifyTopic: topic,
    notifyEmail: !!sendEmail
  });

  return { ok: true, scheduleName: name, scheduledFor: runAt.toISOString(), region: getAwsRegion() };
}

async function cancelSchedule({ scheduleName }) {
  const cfg = getConfig();
  if (!scheduleName) {
    const err = new Error('Missing scheduleName');
    err.status = 400;
    throw err;
  }

  const scheduler = getScheduler();
  await scheduler.send(new DeleteScheduleCommand({
    Name: scheduleName,
    GroupName: cfg.schedulerGroupName
  }));

  return { ok: true };
}

async function publishBlogPostNow({ listItemID, sendEmail = true, topic = 'blog_posts' }) {
  // When scheduler fires, we mark as published and optionally send notifications.
  await assertBlogPostExists(listItemID);
  await updateBlogMetadata(listItemID, {
    status: 'published',
    publishDate: new Date().toISOString(),
    scheduleName: null
  });

  if (sendEmail) {
    return await sendBlogPostNotification({ listItemID, topic });
  }

  return { ok: true, published: true, sent: 0, failed: 0 };
}

module.exports = {
  sendBlogPostNotification,
  schedulePublish,
  cancelSchedule,
  publishBlogPostNow,
  getConfig,
};
