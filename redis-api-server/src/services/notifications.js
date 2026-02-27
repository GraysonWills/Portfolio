const { ScanCommand, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { CreateScheduleCommand, DeleteScheduleCommand } = require('@aws-sdk/client-scheduler');
const { SendMessageBatchCommand } = require('@aws-sdk/client-sqs');

const { getDdbDoc, getSes, getScheduler, getSqs, getAwsRegion } = require('./aws/clients');
const { isContentDdbEnabled, ddbGetContentByListItemId, ddbPutContent } = require('./content-ddb');
const { sha256Hex, randomToken, maskEmail } = require('../utils/crypto');
const { buildNewPostEmail } = require('./email/templates');

const DEFAULT_SUBSCRIBERS_TABLE = 'portfolio-email-subscribers';
const DEFAULT_TOKENS_TABLE = 'portfolio-email-tokens';
const DEFAULT_SCHEDULE_GROUP = 'portfolio-email';
const SQS_BATCH_SIZE = 10;

const CONTENT_BACKEND = String(process.env.CONTENT_BACKEND || 'redis').toLowerCase();
const useDdbAsPrimary = CONTENT_BACKEND === 'dynamodb' || CONTENT_BACKEND === 'ddb';

let redisClient = null;
let contentIndexFns = null;

function getRedisClient() {
  if (redisClient) return redisClient;
  // Lazy load so SQS-only workers can run without Redis env vars.
  // eslint-disable-next-line global-require
  redisClient = require('../config/redis');
  return redisClient;
}

function getContentIndexFns() {
  if (contentIndexFns) return contentIndexFns;
  // eslint-disable-next-line global-require
  contentIndexFns = require('../utils/content-index');
  return contentIndexFns;
}

function getConfig() {
  const queueUrl = String(process.env.NOTIFICATION_QUEUE_URL || '').trim();
  const queueEnabled = process.env.NOTIFICATION_QUEUE_ENABLED !== 'false' && !!queueUrl;
  return {
    subscribersTable: process.env.SUBSCRIBERS_TABLE_NAME || DEFAULT_SUBSCRIBERS_TABLE,
    tokensTable: process.env.TOKENS_TABLE_NAME || DEFAULT_TOKENS_TABLE,
    publicSiteUrl: (process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, ''),
    emailBrandLogoUrl: String(process.env.EMAIL_BRAND_LOGO_URL || '').trim() || `${(process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, '')}/favicon.png`,
    sesFromEmail: process.env.SES_FROM_EMAIL || '',
    schedulerGroupName: process.env.SCHEDULER_GROUP_NAME || DEFAULT_SCHEDULE_GROUP,
    schedulerInvokeRoleArn: process.env.SCHEDULER_INVOKE_ROLE_ARN || '',
    schedulerTargetLambdaArn: process.env.SCHEDULER_TARGET_LAMBDA_ARN || '',
    emailNotificationsEnabled: process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'false',
    emailSendAllowlist: process.env.EMAIL_SEND_ALLOWLIST
      ? process.env.EMAIL_SEND_ALLOWLIST.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : null,
    notificationQueueUrl: queueUrl,
    notificationQueueEnabled: queueEnabled,
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getBlogGroupWithRetry(listItemID, { maxWaitMs = 5000, requireBody = false } = {}) {
  // DynamoDB GSIs (used for ListItemID) are eventually consistent. When the authoring
  // UI saves a post then immediately schedules it, the query can briefly return 0 items.
  // We retry a few times to avoid false 404s.
  const deadline = Date.now() + Math.max(0, Number(maxWaitMs) || 0);
  let attempt = 0;

  while (true) {
    const items = await getBlogGroup(listItemID);
    const ok = requireBody ? (items.length && hasBlogContent(items)) : items.length;
    if (ok) return items;

    if (!useDdbAsPrimary) return items || [];
    if (Date.now() >= deadline) return items || [];

    attempt += 1;
    const backoff = Math.min(1000, 120 * Math.pow(2, attempt));
    await sleep(backoff);
  }
}

async function setRedisDocument(contentId, doc) {
  const client = getRedisClient();
  const { addToIndex } = getContentIndexFns();
  const key = `content:${contentId}`;
  try {
    await client.json.set(key, '$', doc);
  } catch (err) {
    await client.set(key, JSON.stringify(doc));
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
    const { getContentWhere } = getContentIndexFns();
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
  const items = await getBlogGroupWithRetry(listItemID, { maxWaitMs: 5000, requireBody: true });
  if (!items.length || !hasBlogContent(items)) {
    const err = new Error('Blog post not found');
    err.status = 404;
    throw err;
  }
  return items;
}

async function ensureBlogItemMetadataRecord(listItemID, fallbackMeta = {}) {
  const items = await getBlogGroupWithRetry(listItemID, { maxWaitMs: 5000, requireBody: false });
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
  const items = await getBlogGroupWithRetry(listItemID, { maxWaitMs: 5000, requireBody: false });
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
    readTimeMinutes,
    brandLogoUrl: cfg.emailBrandLogoUrl
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
      ProjectionExpression: 'emailHash, email, topics, #status'
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

function getSendMarkerKey(listItemID, topic) {
  return sha256Hex(`blog_notify_sent:${String(topic || 'blog_posts').trim().toLowerCase()}:${String(listItemID || '').trim()}`);
}

async function hasBlogNotificationBeenSent({ listItemID, topic = 'blog_posts' }) {
  const cfg = getConfig();
  const ddb = getDdbDoc();
  const tokenHash = getSendMarkerKey(listItemID, topic);

  const res = await ddb.send(new GetCommand({
    TableName: cfg.tokensTable,
    Key: { tokenHash }
  }));

  const item = res?.Item;
  return !!item && String(item.action || '') === 'blog_notify_sent';
}

async function markBlogNotificationSent({
  listItemID,
  topic = 'blog_posts',
  delivery = 'unknown',
  recipientCount = 0
}) {
  const cfg = getConfig();
  const ddb = getDdbDoc();
  const nowIso = new Date().toISOString();
  const tokenHash = getSendMarkerKey(listItemID, topic);

  await ddb.send(new PutCommand({
    TableName: cfg.tokensTable,
    Item: {
      tokenHash,
      action: 'blog_notify_sent',
      listItemID: String(listItemID || '').trim(),
      topic: String(topic || 'blog_posts').trim().toLowerCase(),
      delivery,
      recipientCount: Number(recipientCount || 0),
      createdAt: nowIso
    }
  }));

  // Best-effort metadata breadcrumb for debugging in content records.
  try {
    await updateBlogMetadata(listItemID, {
      emailNotificationSentAt: nowIso,
      emailNotificationTopic: String(topic || 'blog_posts').trim().toLowerCase(),
      emailNotificationDelivery: delivery,
      emailNotificationRecipientCount: Number(recipientCount || 0)
    });
  } catch (err) {
    console.error('[notifications] Failed to write metadata send marker:', {
      listItemID,
      message: String(err?.message || err)
    });
  }
}

function isFifoQueueUrl(queueUrl) {
  return String(queueUrl || '').toLowerCase().endsWith('.fifo');
}

function toQueueBody(payload) {
  return JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    ...payload
  });
}

async function enqueueNotificationMessages(messages) {
  const cfg = getConfig();
  if (!cfg.notificationQueueEnabled) {
    return { ok: false, queued: 0, failed: messages.length, reason: 'NOTIFICATION_QUEUE_DISABLED' };
  }
  const queueUrl = cfg.notificationQueueUrl;
  const sqs = getSqs();
  const fifo = isFifoQueueUrl(queueUrl);

  let queued = 0;
  let failed = 0;

  for (let i = 0; i < messages.length; i += SQS_BATCH_SIZE) {
    const batch = messages.slice(i, i + SQS_BATCH_SIZE);
    const Entries = batch.map((msg, idx) => {
      const body = toQueueBody(msg);
      const entry = {
        Id: `msg-${i + idx}`,
        MessageBody: body
      };

      if (fifo) {
        const hashInput = `${msg?.type || 'notification'}:${msg?.listItemID || ''}:${msg?.to || ''}:${msg?.topic || 'blog_posts'}`;
        entry.MessageGroupId = `blog-${sha256Hex(String(msg?.listItemID || 'general')).slice(0, 32)}`;
        entry.MessageDeduplicationId = sha256Hex(hashInput);
      }

      return entry;
    });

    const result = await sqs.send(new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries
    }));

    const successCount = Array.isArray(result?.Successful) ? result.Successful.length : 0;
    const failedItems = Array.isArray(result?.Failed) ? result.Failed : [];

    queued += successCount;
    failed += failedItems.length;

    if (failedItems.length) {
      for (const item of failedItems) {
        const index = Number(String(item.Id || '').replace('msg-', ''));
        const payload = Number.isFinite(index) ? messages[index] : null;
        console.error('[notifications] Queue enqueue failed:', {
          listItemID: payload?.listItemID || null,
          to: payload?.to ? maskEmail(payload.to) : null,
          code: item?.Code || null,
          message: item?.Message || null
        });
      }
    }
  }

  return { ok: failed === 0, queued, failed };
}

async function queueBlogPostNotifications({
  recipients,
  listItemID,
  topic,
  title,
  summary,
  postUrl,
  imageUrl,
  tags,
  readTimeMinutes
}) {
  const messages = [];
  for (const r of recipients) {
    const email = String(r.email || '').toLowerCase().trim();
    if (!email) continue;

    messages.push({
      type: 'blog_post_notification',
      listItemID,
      topic,
      emailHash: r.emailHash,
      to: email,
      title,
      summary,
      postUrl,
      imageUrl: imageUrl || null,
      tags: Array.isArray(tags) ? tags : [],
      readTimeMinutes: readTimeMinutes || null
    });
  }

  if (!messages.length) {
    return { ok: true, queued: 0, failed: 0, total: recipients.length };
  }

  const out = await enqueueNotificationMessages(messages);
  return {
    ok: out.ok,
    queued: out.queued,
    failed: out.failed,
    total: recipients.length
  };
}

async function processNotificationQueueMessage(message) {
  const cfg = getConfig();
  const type = String(message?.type || '').trim();
  if (type !== 'blog_post_notification') {
    throw new Error(`Unsupported queue message type: ${type || 'unknown'}`);
  }

  const email = String(message?.to || '').toLowerCase().trim();
  if (!email) throw new Error('Queue message missing recipient email');
  if (!message?.postUrl) throw new Error('Queue message missing postUrl');

  const emailHash = String(message?.emailHash || '').trim() || sha256Hex(email);
  const unsubToken = await createUnsubscribeToken(emailHash);
  const unsubscribeUrl = `${cfg.publicSiteUrl}/notifications/unsubscribe?token=${encodeURIComponent(unsubToken)}`;

  await sendNewPostEmail({
    to: email,
    title: message?.title || 'Untitled',
    summary: message?.summary || '',
    postUrl: message.postUrl,
    unsubscribeUrl,
    imageUrl: message?.imageUrl || null,
    tags: Array.isArray(message?.tags) ? message.tags : [],
    readTimeMinutes: message?.readTimeMinutes || null
  });

  const ddb = getDdbDoc();
  try {
    await ddb.send(new UpdateCommand({
      TableName: cfg.subscribersTable,
      Key: { emailHash },
      ConditionExpression: 'attribute_exists(emailHash)',
      UpdateExpression: 'SET #lastNotifiedAt = :now, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#lastNotifiedAt': 'lastNotifiedAt',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':now': new Date().toISOString()
      }
    }));
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      console.error('[notifications] Failed to update lastNotifiedAt:', {
        to: maskEmail(email),
        message: String(err?.message || err)
      });
    }
  }
}

async function processNotificationQueueRecords(records) {
  const failures = [];
  let processed = 0;

  for (const record of records || []) {
    const messageId = String(record?.messageId || record?.messageID || '');
    try {
      const body = typeof record?.body === 'string' ? JSON.parse(record.body) : record?.body;
      await processNotificationQueueMessage(body || {});
      processed += 1;
    } catch (err) {
      console.error('[notifications] Queue processing failed:', {
        messageId: messageId || null,
        message: String(err?.message || err)
      });
      if (messageId) failures.push({ itemIdentifier: messageId });
    }
  }

  return {
    ok: failures.length === 0,
    processed,
    failed: failures.length,
    batchItemFailures: failures
  };
}

async function sendBlogPostNotification({ listItemID, topic = 'blog_posts', force = false }) {
  const cfg = getConfig();
  if (!cfg.emailNotificationsEnabled) {
    return { ok: true, skipped: true, reason: 'EMAIL_NOTIFICATIONS_ENABLED=false' };
  }

  const normalizedTopic = String(topic || 'blog_posts').trim().toLowerCase() || 'blog_posts';
  const normalizedListItemID = String(listItemID || '').trim();
  if (!normalizedListItemID) {
    const err = new Error('Missing listItemID');
    err.status = 400;
    throw err;
  }

  if (!force) {
    const alreadySent = await hasBlogNotificationBeenSent({
      listItemID: normalizedListItemID,
      topic: normalizedTopic
    });
    if (alreadySent) {
      return {
        ok: true,
        skipped: true,
        reason: 'ALREADY_SENT',
        listItemID: normalizedListItemID,
        topic: normalizedTopic
      };
    }
  }

  const items = await assertBlogPostExists(normalizedListItemID);

  const { title, summary, tags } = extractBlogMetadata(items);
  const imageUrl = extractBlogHeroImage(items);
  const readTimeMinutes = estimateReadTimeMinutesFromItems(items);
  const postUrl = `${cfg.publicSiteUrl}/blog/${encodeURIComponent(normalizedListItemID)}`;

  const recipients = await listSubscribedRecipients({ topic: normalizedTopic });
  if (cfg.notificationQueueEnabled) {
    const queueResult = await queueBlogPostNotifications({
      recipients,
      listItemID: normalizedListItemID,
      topic: normalizedTopic,
      title,
      summary,
      postUrl,
      imageUrl,
      tags,
      readTimeMinutes
    });

    if (queueResult.ok && Number(queueResult.failed || 0) === 0) {
      await markBlogNotificationSent({
        listItemID: normalizedListItemID,
        topic: normalizedTopic,
        delivery: 'queued',
        recipientCount: queueResult.total || 0
      });
    }

    return {
      ok: queueResult.ok,
      delivery: 'queued',
      queued: queueResult.queued,
      failed: queueResult.failed,
      total: queueResult.total,
      topic: normalizedTopic,
      listItemID: normalizedListItemID
    };
  }

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

  if (failed === 0) {
    await markBlogNotificationSent({
      listItemID: normalizedListItemID,
      topic: normalizedTopic,
      delivery: 'direct',
      recipientCount: recipients.length
    });
  }

  return {
    ok: true,
    delivery: 'direct',
    sent,
    failed,
    total: recipients.length,
    topic: normalizedTopic,
    listItemID: normalizedListItemID
  };
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
  processNotificationQueueRecords,
  getConfig,
};
