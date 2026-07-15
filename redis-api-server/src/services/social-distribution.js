const { GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { CreateScheduleCommand, DeleteScheduleCommand, GetScheduleCommand } = require('@aws-sdk/client-scheduler');

const { getDdbDoc, getScheduler, getAwsRegion } = require('./aws/clients');
const socialAuth = require('./social-auth');
const { sha256Hex } = require('../utils/crypto');

const DEFAULT_TABLE = 'portfolio-social-auth';
const DELIVERY_STATUS = new Set(['draft', 'needs_review', 'scheduled', 'sending', 'sent', 'failed', 'unknown', 'skipped']);
const POSTING_PROVIDERS = new Set([
  'x', 'linkedin', 'facebook', 'instagram', 'threads', 'tiktok', 'reddit',
  'pinterest', 'mastodon', 'tumblr', 'medium', 'google', 'discord'
]);

function getTableName() {
  return String(
    process.env.SOCIAL_DISTRIBUTION_TABLE_NAME
    || process.env.SOCIAL_AUTH_TABLE_NAME
    || DEFAULT_TABLE
  ).trim();
}

function getSchedulerConfig() {
  return {
    schedulerGroupName: process.env.SOCIAL_DISTRIBUTION_SCHEDULER_GROUP_NAME || process.env.SCHEDULER_GROUP_NAME || 'portfolio-email',
    schedulerInvokeRoleArn: process.env.SCHEDULER_INVOKE_ROLE_ARN || '',
    schedulerTargetLambdaArn: process.env.SCHEDULER_TARGET_LAMBDA_ARN || ''
  };
}

function getPublicSiteUrl() {
  return String(process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, '');
}

function userSubFrom(input) {
  if (typeof input === 'string') return input.trim();
  return socialAuth.userKey(input);
}

function settingsKey(userSub) {
  return { pk: `USER#${userSub}`, sk: 'SOCIAL_DISTRIBUTION#SETTINGS' };
}

function deliveryKey(userSub, deliveryId) {
  return { pk: `USER#${userSub}`, sk: `DELIVERY#${deliveryId}` };
}

function nowIso() {
  return new Date().toISOString();
}

function toAtExpression(date) {
  const iso = new Date(date).toISOString();
  return `at(${iso.replace(/\.\d{3}Z$/, '').replace(/Z$/, '')})`;
}

function safeScheduleName(deliveryId) {
  return `social-${sha256Hex(String(deliveryId || '')).slice(0, 40)}`;
}

function getDefaultSettings() {
  return {
    templates: [
      {
        id: 'launch-note',
        name: 'Launch note',
        platformId: 'all',
        destination: 'Feed post',
        body: 'New post: {{title}}\n\n{{summary}}\n\nRead it here: {{url}}',
        hashtags: '{{tags}}',
        useCoverImage: true
      },
      {
        id: 'x-short-post',
        name: 'X short post',
        platformId: 'x',
        destination: 'Single post',
        body: '{{title}}\n\n{{summary}}\n\n{{url}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      },
      {
        id: 'linkedin-reflection',
        name: 'LinkedIn reflection',
        platformId: 'linkedin',
        destination: 'Personal update',
        body: 'I published a new essay: {{title}}\n\n{{summary}}\n\n{{url}}',
        hashtags: '{{tags}}',
        useCoverImage: true
      },
      {
        id: 'instagram-story',
        name: 'Instagram story draft',
        platformId: 'instagram',
        destination: 'Story',
        body: '{{title}}\n\n{{summary}}\n\nLink: {{url}}',
        hashtags: '{{tags}}',
        useCoverImage: true
      },
      {
        id: 'threads-short-post',
        name: 'Threads short post',
        platformId: 'threads',
        destination: 'Post',
        body: '{{title}}\n\n{{summary}}\n\n{{url}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      },
      {
        id: 'tiktok-photo-upload',
        name: 'TikTok photo upload',
        platformId: 'tiktok',
        destination: 'Photo upload',
        body: '{{title}}\n\n{{summary}}\n\n{{url}}',
        hashtags: '{{tags}}',
        useCoverImage: true
      },
      {
        id: 'reddit-profile-link',
        name: 'Reddit profile link',
        platformId: 'reddit',
        destination: 'Profile post',
        body: '{{summary}}\n\n{{url}}',
        hashtags: '',
        useCoverImage: false
      },
      {
        id: 'pinterest-blog-pin',
        name: 'Pinterest blog pin',
        platformId: 'pinterest',
        destination: 'Board pin',
        body: '{{title}}\n\n{{summary}}\n\n{{url}}',
        hashtags: '{{tags}}',
        useCoverImage: true
      },
      {
        id: 'mastodon-status',
        name: 'Mastodon status',
        platformId: 'mastodon',
        destination: 'Public post',
        body: '{{title}}\n\n{{summary}}\n\n{{url}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      },
      {
        id: 'tumblr-link-post',
        name: 'Tumblr link post',
        platformId: 'tumblr',
        destination: 'Link post',
        body: '{{summary}}\n\n{{url}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      },
      {
        id: 'medium-draft',
        name: 'Medium draft',
        platformId: 'medium',
        destination: 'Draft',
        body: '# {{title}}\n\n{{summary}}\n\nOriginally published: {{url}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      },
      {
        id: 'discord-announcement',
        name: 'Discord announcement',
        platformId: 'discord',
        destination: 'Announcement channel',
        body: 'New post: {{title}}\n\n{{summary}}\n\n{{url}}',
        hashtags: '',
        useCoverImage: false
      }
    ],
    rules: [
      {
        id: 'publish-announcement',
        name: 'Publish announcement',
        trigger: 'blog_published',
        enabled: true,
        templateId: 'launch-note',
        platformIds: ['x', 'linkedin', 'facebook'],
        delayMinutes: 0,
        requiresReview: false,
        quietMode: true
      },
      {
        id: 'visual-story-draft',
        name: 'Visual story draft',
        trigger: 'blog_published',
        enabled: false,
        templateId: 'instagram-story',
        platformIds: ['instagram'],
        delayMinutes: 5,
        requiresReview: true,
        quietMode: true
      },
      {
        id: 'scheduled-reminder',
        name: 'Scheduled post reminder',
        trigger: 'blog_scheduled',
        enabled: true,
        templateId: 'linkedin-reflection',
        platformIds: ['linkedin'],
        delayMinutes: 1,
        requiresReview: true,
        quietMode: true
      }
    ]
  };
}

function normalizeTrigger(value) {
  if (value === 'blog_scheduled' || value === 'manual_review') return value;
  return 'blog_published';
}

function normalizeSettings(input = {}) {
  const defaults = getDefaultSettings();
  const templateById = new Map(defaults.templates.map((template) => [template.id, template]));
  const ruleById = new Map(defaults.rules.map((rule) => [rule.id, rule]));

  for (const template of input?.templates || []) {
    if (!template?.id) continue;
    templateById.set(String(template.id), {
      id: String(template.id),
      name: String(template.name || 'Untitled template'),
      platformId: String(template.platformId || 'all'),
      destination: String(template.destination || 'Post'),
      body: String(template.body || ''),
      hashtags: String(template.hashtags || ''),
      useCoverImage: template.useCoverImage !== false
    });
  }

  for (const rule of input?.rules || []) {
    if (!rule?.id) continue;
    ruleById.set(String(rule.id), {
      id: String(rule.id),
      name: String(rule.name || 'Untitled rule'),
      trigger: normalizeTrigger(rule.trigger),
      enabled: rule.enabled !== false,
      templateId: String(rule.templateId || defaults.templates[0].id),
      platformIds: Array.isArray(rule.platformIds) ? rule.platformIds.map(String).filter(Boolean) : [],
      delayMinutes: Math.max(0, Math.min(1440, Number(rule.delayMinutes) || 0)),
      requiresReview: Boolean(rule.requiresReview),
      quietMode: rule.quietMode !== false
    });
  }

  return {
    templates: Array.from(templateById.values()),
    rules: Array.from(ruleById.values())
  };
}

async function getSettingsForUserSub(userSub) {
  const res = await getDdbDoc().send(new GetCommand({
    TableName: getTableName(),
    Key: settingsKey(userSub),
    ConsistentRead: true
  })).catch((err) => {
    if (err?.name === 'ResourceNotFoundException') return { Item: null };
    throw err;
  });

  return normalizeSettings(res?.Item?.settings || {});
}

async function getSettings(user) {
  return getSettingsForUserSub(userSubFrom(user));
}

async function saveSettings(user, settings) {
  const userSub = userSubFrom(user);
  const normalized = normalizeSettings(settings);
  const timestamp = nowIso();
  await getDdbDoc().send(new PutCommand({
    TableName: getTableName(),
    Item: {
      ...settingsKey(userSub),
      type: 'social_distribution_settings',
      userSub,
      settings: normalized,
      updatedAt: timestamp
    }
  }));
  return normalized;
}

function replaceVariables(value, values) {
  return String(value || '').replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, key) => values[key] || '');
}

function renderTemplate(template, context) {
  const values = {
    title: context.title,
    summary: context.summary,
    url: context.url,
    category: context.category,
    tags: context.tags,
    publishedDate: context.publishedDate,
    readingTime: context.readingTime,
    coverImage: context.coverImage
  };
  const body = replaceVariables(template.body, values).trim();
  const hashtags = replaceVariables(template.hashtags, values).trim();
  return [body, hashtags].filter(Boolean).join('\n\n');
}

function buildPreviews(settings, context, trigger, baseDate = new Date()) {
  const templates = new Map(settings.templates.map((template) => [template.id, template]));
  return settings.rules
    .filter((rule) => rule.enabled && rule.trigger === trigger)
    .flatMap((rule) => {
      const template = templates.get(rule.templateId);
      if (!template) return [];
      return rule.platformIds.map((platformId) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        templateId: template.id,
        templateName: template.name,
        platformId,
        destination: template.destination,
        caption: renderTemplate(template, context),
        runAt: new Date(baseDate.getTime() + Math.max(0, Number(rule.delayMinutes) || 0) * 60_000),
        delayMinutes: Math.max(0, Number(rule.delayMinutes) || 0),
        requiresReview: Boolean(rule.requiresReview),
        quietMode: rule.quietMode !== false,
        usesCoverImage: Boolean(template.useCoverImage),
        mediaUrl: template.useCoverImage ? context.coverImage : ''
      }));
    });
}

function sanitizeDelivery(item) {
  if (!item) return null;
  return {
    deliveryId: item.deliveryId,
    listItemID: item.listItemID,
    trigger: item.trigger,
    ruleId: item.ruleId,
    ruleName: item.ruleName,
    templateId: item.templateId,
    templateName: item.templateName,
    provider: item.provider,
    accountId: item.accountId || '',
    accountLabel: item.accountLabel || '',
    destination: item.destination || 'Post',
    caption: item.caption || '',
    mediaUrl: item.mediaUrl || '',
    postUrl: item.postUrl || '',
    title: item.title || '',
    runAt: item.runAt || null,
    status: DELIVERY_STATUS.has(item.status) ? item.status : 'draft',
    requiresReview: Boolean(item.requiresReview),
    quietMode: item.quietMode !== false,
    providerPostId: item.providerPostId || '',
    providerPostUrl: item.providerPostUrl || '',
    lastError: item.lastError || '',
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    sentAt: item.sentAt || null,
    attemptCount: Number(item.attemptCount || 0),
    scheduleName: item.scheduleName || ''
  };
}

async function listDeliveries(user, { limit = 100 } = {}) {
  const userSub = userSubFrom(user);
  const res = await getDdbDoc().send(new QueryCommand({
    TableName: getTableName(),
    ConsistentRead: true,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
    ExpressionAttributeNames: {
      '#pk': 'pk',
      '#sk': 'sk'
    },
    ExpressionAttributeValues: {
      ':pk': `USER#${userSub}`,
      ':prefix': 'DELIVERY#'
    },
    Limit: Math.max(1, Math.min(200, Number(limit) || 100))
  }));

  const deliveries = (res?.Items || [])
    .map(sanitizeDelivery)
    .filter(Boolean)
    .sort((a, b) => String(b.runAt || b.createdAt || '').localeCompare(String(a.runAt || a.createdAt || '')));

  return { deliveries };
}

function buildBlogContext({ listItemID, blog = {}, baseDate = new Date() } = {}) {
  const title = String(blog.title || 'Untitled').trim() || 'Untitled';
  const summary = String(blog.summary || '').trim();
  const tags = Array.isArray(blog.tags) ? blog.tags.join(' ') : String(blog.tags || '').trim();
  const publicSiteUrl = getPublicSiteUrl();
  const url = String(blog.url || `${publicSiteUrl}/blog/${encodeURIComponent(listItemID)}`).trim();
  const publishedDate = new Date(baseDate);
  const readTime = Number(blog.readTimeMinutes || 0);

  return {
    title,
    summary,
    url,
    category: String(blog.category || '').trim(),
    tags,
    publishedDate: Number.isNaN(publishedDate.getTime()) ? '' : publishedDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }),
    readingTime: readTime > 0 ? `${Math.round(readTime)} min read` : '',
    coverImage: String(blog.coverImage || blog.imageUrl || '').trim()
  };
}

function getDeliveryId({ listItemID, trigger, ruleId, provider, accountId }) {
  return sha256Hex([
    String(listItemID || '').trim(),
    String(trigger || '').trim(),
    String(ruleId || '').trim(),
    String(provider || '').trim(),
    String(accountId || 'unselected').trim()
  ].join(':'));
}

async function getDeliveryById({ userSub, deliveryId }) {
  const res = await getDdbDoc().send(new GetCommand({
    TableName: getTableName(),
    Key: deliveryKey(userSub, deliveryId),
    ConsistentRead: true
  }));
  return res?.Item || null;
}

async function putDeliveryIfAbsent(delivery) {
  try {
    await getDdbDoc().send(new PutCommand({
      TableName: getTableName(),
      Item: delivery,
      ConditionExpression: 'attribute_not_exists(pk)'
    }));
    return { created: true, delivery };
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
    const existing = await getDeliveryById({
      userSub: delivery.userSub,
      deliveryId: delivery.deliveryId
    });
    return { created: false, delivery: existing };
  }
}

async function updateDelivery(userSub, deliveryId, patch) {
  const names = { '#updatedAt': 'updatedAt' };
  const values = { ':updatedAt': nowIso() };
  const sets = ['#updatedAt = :updatedAt'];

  for (const [key, value] of Object.entries(patch || {})) {
    const nameKey = `#${key}`;
    const valueKey = `:${key}`;
    names[nameKey] = key;
    values[valueKey] = value;
    sets.push(`${nameKey} = ${valueKey}`);
  }

  const res = await getDdbDoc().send(new UpdateCommand({
    TableName: getTableName(),
    Key: deliveryKey(userSub, deliveryId),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW'
  }));
  return res?.Attributes || null;
}

async function claimDeliveryForSend(delivery) {
  const userSub = String(delivery.userSub || '').trim();
  const deliveryId = String(delivery.deliveryId || '').trim();
  const expectedStatus = String(delivery.status || 'draft');
  const attempts = Number(delivery.attemptCount || 0) + 1;

  try {
    const res = await getDdbDoc().send(new UpdateCommand({
      TableName: getTableName(),
      Key: deliveryKey(userSub, deliveryId),
      UpdateExpression: 'SET #status = :sending, #attemptCount = :attempts, #lastError = :empty, #updatedAt = :updatedAt',
      ConditionExpression: '#status = :expectedStatus',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#attemptCount': 'attemptCount',
        '#lastError': 'lastError',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':sending': 'sending',
        ':expectedStatus': expectedStatus,
        ':attempts': attempts,
        ':empty': '',
        ':updatedAt': nowIso()
      },
      ReturnValues: 'ALL_NEW'
    }));
    return res?.Attributes || { ...delivery, status: 'sending', attemptCount: attempts };
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
    const current = await getDeliveryById({ userSub, deliveryId });
    if (current?.status === 'sent') return current;
    const currentStatus = String(current?.status || 'missing');
    const conflict = new Error(
      currentStatus === 'unknown'
        ? 'Delivery outcome is unknown and requires manual reconciliation'
        : `Delivery is already ${currentStatus}; refusing a concurrent send`
    );
    conflict.status = 409;
    throw conflict;
  }
}

async function scheduleDelivery(delivery) {
  const cfg = getSchedulerConfig();
  if (!cfg.schedulerInvokeRoleArn || !cfg.schedulerTargetLambdaArn) {
    return updateDelivery(delivery.userSub, delivery.deliveryId, {
      status: 'failed',
      lastError: 'Scheduler is not configured for delayed social posts'
    });
  }

  const runAt = new Date(delivery.runAt);
  const scheduleName = safeScheduleName(delivery.deliveryId);
  const input = {
    Name: scheduleName,
    GroupName: cfg.schedulerGroupName,
    ClientToken: sha256Hex(`social-schedule:${delivery.deliveryId}`),
    FlexibleTimeWindow: { Mode: 'OFF' },
    ScheduleExpression: toAtExpression(runAt),
    ScheduleExpressionTimezone: 'UTC',
    ActionAfterCompletion: 'DELETE',
    Target: {
      Arn: cfg.schedulerTargetLambdaArn,
      RoleArn: cfg.schedulerInvokeRoleArn,
      Input: JSON.stringify({
        kind: 'social_distribution_send',
        userSub: delivery.userSub,
        deliveryId: delivery.deliveryId
      })
    }
  };
  try {
    await getScheduler().send(new CreateScheduleCommand(input));
  } catch (err) {
    if (err?.name !== 'ConflictException') throw err;
    const existing = await getScheduler().send(new GetScheduleCommand({
      Name: scheduleName,
      GroupName: cfg.schedulerGroupName
    }));
    if (
      existing?.ScheduleExpression !== input.ScheduleExpression
      || existing?.Target?.Arn !== input.Target.Arn
      || existing?.Target?.Input !== input.Target.Input
    ) {
      const conflict = new Error('Existing scheduler identity has different delivery parameters');
      conflict.status = 409;
      throw conflict;
    }
  }

  return updateDelivery(delivery.userSub, delivery.deliveryId, {
    status: 'scheduled',
    scheduleName,
    requiresReview: false,
    lastError: ''
  });
}

async function scheduleDeliveryAtForUser(user, deliveryId) {
  const userSub = userSubFrom(user);
  const delivery = await getDeliveryById({ userSub, deliveryId });
  if (!delivery) {
    const err = new Error('Delivery not found');
    err.status = 404;
    throw err;
  }
  if (delivery.status === 'scheduled') {
    return { scheduled: true, delivery: sanitizeDelivery(delivery), conflict: null };
  }
  if (delivery.status !== 'draft') {
    const err = new Error(`Delivery is already ${delivery.status}; refusing to schedule it`);
    err.status = 409;
    throw err;
  }
  if (String(delivery.provider || '').toLowerCase() !== 'linkedin') {
    const err = new Error('Delayed pre-gated delivery currently supports LinkedIn only');
    err.status = 400;
    throw err;
  }
  const runAt = new Date(delivery.runAt);
  if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) {
    const err = new Error('runAt must be a future date');
    err.status = 400;
    throw err;
  }
  if (!delivery.accountId || delivery.lastError) {
    const err = new Error(`Provider is not ready: ${delivery.lastError || 'LinkedIn account is not connected'}`);
    err.status = 409;
    throw err;
  }

  const scheduled = await scheduleDelivery(delivery);
  if (scheduled?.status !== 'scheduled') {
    const err = new Error(scheduled?.lastError || 'Unable to create delayed social schedule');
    err.status = 503;
    throw err;
  }
  return { scheduled: true, delivery: sanitizeDelivery(scheduled), conflict: null };
}

async function processBlogAutomation({ userSub, listItemID, trigger = 'blog_published', baseDate = new Date(), blog = {} } = {}) {
  const normalizedUserSub = String(userSub || '').trim();
  const normalizedListItemID = String(listItemID || '').trim();
  if (!normalizedUserSub || !normalizedListItemID) {
    return { ok: false, created: 0, sent: 0, failed: 0, skipped: 0, reason: 'MISSING_USER_OR_POST' };
  }

  const settings = await getSettingsForUserSub(normalizedUserSub);
  const context = buildBlogContext({ listItemID: normalizedListItemID, blog, baseDate });
  const previews = buildPreviews(settings, context, normalizeTrigger(trigger), new Date(baseDate));
  const results = [];

  for (const preview of previews) {
    let credential = null;
    try {
      credential = await socialAuth.getPostingCredential(preview.platformId, { sub: normalizedUserSub });
    } catch (err) {
      const deliveryId = getDeliveryId({
        listItemID: normalizedListItemID,
        trigger,
        ruleId: preview.ruleId,
        provider: preview.platformId,
        accountId: 'unavailable'
      });
      const timestamp = nowIso();
      const delivery = {
        ...deliveryKey(normalizedUserSub, deliveryId),
        type: 'social_delivery',
        deliveryId,
        userSub: normalizedUserSub,
        listItemID: normalizedListItemID,
        trigger,
        ruleId: preview.ruleId,
        ruleName: preview.ruleName,
        templateId: preview.templateId,
        templateName: preview.templateName,
        provider: preview.platformId,
        accountId: '',
        accountLabel: '',
        destination: preview.destination,
        caption: preview.caption,
        mediaUrl: preview.mediaUrl,
        postUrl: context.url,
        title: context.title,
        runAt: preview.runAt.toISOString(),
        status: 'failed',
        requiresReview: preview.requiresReview,
        quietMode: preview.quietMode,
        lastError: err?.message || 'Provider is not connected',
        attemptCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const saved = await putDeliveryIfAbsent(delivery);
      results.push({ deliveryId, status: saved.delivery?.status || 'failed', created: saved.created });
      continue;
    }

    const deliveryId = getDeliveryId({
      listItemID: normalizedListItemID,
      trigger,
      ruleId: preview.ruleId,
      provider: preview.platformId,
      accountId: credential.accountId || credential.accountLabel || 'default'
    });
    const timestamp = nowIso();
    const delivery = {
      ...deliveryKey(normalizedUserSub, deliveryId),
      type: 'social_delivery',
      deliveryId,
      userSub: normalizedUserSub,
      listItemID: normalizedListItemID,
      trigger,
      ruleId: preview.ruleId,
      ruleName: preview.ruleName,
      templateId: preview.templateId,
      templateName: preview.templateName,
      provider: preview.platformId,
      accountId: credential.accountId || '',
      accountLabel: credential.accountLabel || '',
      destination: preview.destination,
      caption: preview.caption,
      mediaUrl: preview.mediaUrl,
      postUrl: context.url,
      title: context.title,
      runAt: preview.runAt.toISOString(),
      status: preview.requiresReview ? 'needs_review' : preview.delayMinutes > 0 ? 'scheduled' : 'draft',
      requiresReview: preview.requiresReview,
      quietMode: preview.quietMode,
      lastError: '',
      attemptCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const saved = await putDeliveryIfAbsent(delivery);
    if (!saved.created) {
      results.push({ deliveryId, status: saved.delivery?.status || 'skipped', created: false });
      continue;
    }

    if (delivery.requiresReview) {
      results.push({ deliveryId, status: 'needs_review', created: true });
      continue;
    }

    if (preview.delayMinutes > 0) {
      const scheduled = await scheduleDelivery(delivery);
      results.push({ deliveryId, status: scheduled?.status || 'scheduled', created: true });
      continue;
    }

    const sent = await sendDeliveryRecord(delivery, credential);
    results.push({ deliveryId, status: sent?.status || 'failed', created: true });
  }

  return {
    ok: true,
    created: results.filter((r) => r.created).length,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => ['failed', 'unknown'].includes(r.status)).length,
    skipped: results.filter((r) => !r.created).length,
    deliveries: results
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
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

  return payload;
}

async function postForm(url, params) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
}

function assertAccessToken(credential) {
  const token = credential?.token?.access_token;
  if (!token) throw new Error('Provider credential is missing an access token');
  return token;
}

async function postToX(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const payload = await fetchJson('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: delivery.caption })
  });
  const id = String(payload?.data?.id || '');
  return {
    providerPostId: id,
    providerPostUrl: id ? `https://x.com/i/web/status/${id}` : ''
  };
}

async function postToLinkedIn(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const personId = credential.accountId || credential.account?.id;
  if (!personId) throw new Error('LinkedIn profile id is missing');
  const author = `urn:li:person:${personId}`;
  const mediaUrl = String(delivery.mediaUrl || '').trim();
  let mediaAsset = '';

  if (/^https?:\/\//i.test(mediaUrl)) {
    const registered = await fetchJson('https://api.linkedin.com/v2/assets?action=registerUpload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0'
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: author,
          serviceRelationships: [
            {
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent'
            }
          ]
        }
      })
    });
    const uploadMechanism = registered?.value?.uploadMechanism
      ?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'];
    const uploadUrl = String(uploadMechanism?.uploadUrl || '');
    mediaAsset = String(registered?.value?.asset || '');
    if (!uploadUrl || !mediaAsset) throw new Error('LinkedIn did not provide an image upload target');

    const imageResponse = await fetch(mediaUrl);
    if (!imageResponse.ok) throw new Error(`Unable to download LinkedIn image (HTTP ${imageResponse.status})`);
    const contentType = String(imageResponse.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(contentType)) {
      throw new Error('LinkedIn image must be JPEG, PNG, or GIF');
    }
    const contentLength = Number(imageResponse.headers?.get?.('content-length') || 0);
    if (contentLength > 10 * 1024 * 1024) throw new Error('LinkedIn image exceeds the 10 MB upload limit');
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!imageBuffer.length) throw new Error('LinkedIn image download was empty');
    if (imageBuffer.length > 10 * 1024 * 1024) throw new Error('LinkedIn image exceeds the 10 MB upload limit');

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': contentType
      },
      body: imageBuffer
    });
    if (!uploadResponse.ok) {
      const details = await uploadResponse.text().catch(() => '');
      throw new Error(details || `LinkedIn image upload failed (HTTP ${uploadResponse.status})`);
    }
  }

  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: delivery.caption },
          shareMediaCategory: mediaAsset ? 'IMAGE' : 'NONE',
          ...(mediaAsset ? {
            media: [
              {
                status: 'READY',
                description: { text: String(delivery.title || 'Blog post cover image') },
                media: mediaAsset,
                title: { text: String(delivery.title || 'Blog post cover image') }
              }
            ]
          } : {})
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    })
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(payload?.message || payload?.error?.message || payload?.error || `HTTP ${response.status}`);
    err.status = response.status;
    err.details = payload;
    throw err;
  }

  const id = String(response.headers?.get?.('x-restli-id') || payload?.id || '');
  return { providerPostId: id, providerPostUrl: '' };
}

async function postToFacebook(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const pageId = credential.accountId || credential.account?.id;
  if (!pageId) throw new Error('Facebook Page id is missing');
  const payload = await postForm(`https://graph.facebook.com/v22.0/${encodeURIComponent(pageId)}/feed`, {
    access_token: accessToken,
    message: delivery.caption,
    ...(delivery.postUrl ? { link: delivery.postUrl } : {})
  });
  const id = String(payload?.id || '');
  return {
    providerPostId: id,
    providerPostUrl: id ? `https://facebook.com/${id}` : ''
  };
}

async function postToInstagram(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const igUserId = credential.accountId || credential.account?.id;
  const imageUrl = String(delivery.mediaUrl || '').trim();
  if (!igUserId) throw new Error('Instagram account id is missing');
  if (!/^https?:\/\//i.test(imageUrl)) throw new Error('Instagram requires media');
  const graphBaseUrl = credential.family === 'instagram'
    ? 'https://graph.instagram.com/v23.0'
    : 'https://graph.facebook.com/v22.0';

  const isStory = /story/i.test(String(delivery.destination || ''));
  const createPayload = {
    access_token: accessToken,
    image_url: imageUrl
  };
  if (isStory) {
    createPayload.media_type = 'STORIES';
  } else {
    createPayload.caption = delivery.caption;
  }

  const created = await postForm(`${graphBaseUrl}/${encodeURIComponent(igUserId)}/media`, createPayload);
  const creationId = String(created?.id || '');
  if (!creationId) throw new Error('Instagram did not create a media container');

  const published = await postForm(`${graphBaseUrl}/${encodeURIComponent(igUserId)}/media_publish`, {
    access_token: accessToken,
    creation_id: creationId
  });
  const id = String(published?.id || '');
  return {
    providerPostId: id,
    providerPostUrl: ''
  };
}

async function postToThreads(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const threadsUserId = credential.accountId || credential.account?.id || 'me';
  const imageUrl = String(delivery.mediaUrl || '').trim();
  const text = String(delivery.caption || '').trim();
  if (!text) throw new Error('Threads requires post text');
  if (text.length > 500) throw new Error('Threads posts are limited to 500 characters');

  const createParams = {
    access_token: accessToken,
    media_type: /^https?:\/\//i.test(imageUrl) ? 'IMAGE' : 'TEXT',
    text
  };
  if (createParams.media_type === 'IMAGE') {
    createParams.image_url = imageUrl;
  } else if (/^https?:\/\//i.test(String(delivery.postUrl || ''))) {
    createParams.link_attachment = String(delivery.postUrl).trim();
  }

  const created = await postForm(`https://graph.threads.net/v1.0/${encodeURIComponent(threadsUserId)}/threads`, createParams);
  const creationId = String(created?.id || '');
  if (!creationId) throw new Error('Threads did not create a media container');

  const published = await postForm(`https://graph.threads.net/v1.0/${encodeURIComponent(threadsUserId)}/threads_publish`, {
    access_token: accessToken,
    creation_id: creationId
  });
  const id = String(published?.id || '');
  return {
    providerPostId: id,
    providerPostUrl: ''
  };
}

async function postToTikTok(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const mediaUrl = String(delivery.mediaUrl || '').trim();
  if (!/^https?:\/\//i.test(mediaUrl)) throw new Error('TikTok requires a public photo URL');

  const caption = String(delivery.caption || '').trim();
  const titleSource = String(delivery.postTitle || delivery.title || caption || 'New post').trim();
  const title = Array.from(titleSource).slice(0, 90).join('');
  const description = Array.from(caption).slice(0, 4000).join('');

  const payload = await fetchJson('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({
      post_info: {
        title,
        description
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_cover_index: 0,
        photo_images: [mediaUrl]
      },
      post_mode: 'MEDIA_UPLOAD',
      media_type: 'PHOTO'
    })
  });

  const errorCode = String(payload?.error?.code || 'ok');
  if (errorCode && errorCode !== 'ok') {
    throw new Error(payload?.error?.message || errorCode);
  }

  const publishId = String(payload?.data?.publish_id || '');
  return {
    providerPostId: publishId,
    providerPostUrl: ''
  };
}

function truncateChars(value, max) {
  return Array.from(String(value || '').trim()).slice(0, max).join('');
}

function getRedditUserAgent() {
  return String(process.env.SOCIAL_REDDIT_USER_AGENT || 'web:grayson-wills-portfolio:v1.0 (by /u/graysonwills)').trim();
}

function tagListFromDelivery(delivery, max = 3) {
  return String(delivery.caption || '')
    .split(/\s+/)
    .filter((word) => /^#[\w-]{2,}$/i.test(word))
    .map((word) => word.replace(/^#/, '').slice(0, 25))
    .filter(Boolean)
    .slice(0, max);
}

async function postToReddit(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const username = String(credential.account?.id || credential.accountId || '').replace(/^u\//, '').trim();
  const destination = String(delivery.destination || '').trim();
  const subredditFromDestination = destination.match(/(?:^|\s)(?:r\/|subreddit:)([A-Za-z0-9_]{3,21})/i)?.[1] || '';
  const profileSubreddit = credential.account?.extra?.profileSubreddit || (username ? `u_${username}` : '');
  const subreddit = subredditFromDestination || profileSubreddit;
  if (!subreddit) throw new Error('Reddit destination subreddit is missing');

  const postUrl = String(delivery.postUrl || '').trim();
  const title = truncateChars(delivery.title || delivery.postTitle || delivery.caption || 'New post', 300);
  const isLink = /^https?:\/\//i.test(postUrl);
  const params = {
    api_type: 'json',
    kind: isLink ? 'link' : 'self',
    sr: subreddit,
    title,
    resubmit: 'true',
    sendreplies: 'false'
  };
  if (isLink) params.url = postUrl;
  else params.text = delivery.caption;

  const payload = await fetchJson('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getRedditUserAgent()
    },
    body: new URLSearchParams(params).toString()
  });

  const errors = payload?.json?.errors || [];
  if (Array.isArray(errors) && errors.length) {
    throw new Error(errors.map((err) => err?.[1] || err?.[0]).filter(Boolean).join('; ') || 'Reddit rejected the submission');
  }

  const id = String(payload?.json?.data?.id || payload?.json?.data?.name || '');
  return {
    providerPostId: id,
    providerPostUrl: payload?.json?.data?.url || ''
  };
}

async function postToPinterest(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const boardId = credential.accountId || credential.account?.id;
  const mediaUrl = String(delivery.mediaUrl || '').trim();
  if (!boardId) throw new Error('Pinterest board is not selected');
  if (!/^https?:\/\//i.test(mediaUrl)) throw new Error('Pinterest requires a public image URL');

  const payload = await fetchJson('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      board_id: boardId,
      title: truncateChars(delivery.title || delivery.postTitle || 'New post', 100),
      description: truncateChars(delivery.caption, 500),
      link: /^https?:\/\//i.test(String(delivery.postUrl || '')) ? String(delivery.postUrl).trim() : undefined,
      media_source: {
        source_type: 'image_url',
        url: mediaUrl
      }
    })
  });

  const id = String(payload?.id || '');
  return {
    providerPostId: id,
    providerPostUrl: payload?.link || payload?.url || ''
  };
}

async function postToMastodon(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const instanceUrl = String(credential.token?.instance_url || credential.account?.extra?.instanceUrl || process.env.SOCIAL_MASTODON_INSTANCE_URL || '').replace(/\/+$/, '');
  if (!instanceUrl) throw new Error('Mastodon instance URL is missing');
  const visibility = /unlisted/i.test(String(delivery.destination || '')) ? 'unlisted'
    : /private/i.test(String(delivery.destination || '')) ? 'private'
      : 'public';
  const payload = await fetchJson(`${instanceUrl}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: truncateChars(delivery.caption, 500),
      visibility
    })
  });
  const id = String(payload?.id || '');
  return {
    providerPostId: id,
    providerPostUrl: payload?.url || ''
  };
}

async function postToTumblr(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const blogIdentifier = credential.account?.extra?.name || credential.accountId || credential.account?.handle;
  if (!blogIdentifier) throw new Error('Tumblr blog is not selected');
  const postUrl = String(delivery.postUrl || '').trim();
  const isLink = /^https?:\/\//i.test(postUrl);
  const payload = await fetchJson(`https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: isLink ? 'link' : 'text',
      state: /draft/i.test(String(delivery.destination || '')) ? 'draft' : 'published',
      title: truncateChars(delivery.title || delivery.postTitle || 'New post', 140),
      ...(isLink ? { url: postUrl, description: delivery.caption } : { body: delivery.caption }),
      tags: tagListFromDelivery(delivery, 20).join(',')
    })
  });
  const response = payload?.response || {};
  const id = String(response?.id || response?.id_string || '');
  return {
    providerPostId: id,
    providerPostUrl: response?.post_url || ''
  };
}

async function postToMedium(credential, delivery) {
  const accessToken = assertAccessToken(credential);
  const authorId = credential.accountId || credential.account?.id;
  if (!authorId) throw new Error('Medium author id is missing');
  const postUrl = String(delivery.postUrl || '').trim();
  const publishStatus = /public/i.test(String(delivery.destination || '')) ? 'public'
    : /unlisted/i.test(String(delivery.destination || '')) ? 'unlisted'
      : 'draft';
  const payload = await fetchJson(`https://api.medium.com/v1/users/${encodeURIComponent(authorId)}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Charset': 'utf-8'
    },
    body: JSON.stringify({
      title: truncateChars(delivery.title || delivery.postTitle || 'New post', 100),
      contentFormat: 'markdown',
      content: delivery.caption,
      canonicalUrl: /^https?:\/\//i.test(postUrl) ? postUrl : undefined,
      tags: tagListFromDelivery(delivery, 3),
      publishStatus,
      notifyFollowers: false
    })
  });
  const data = payload?.data || {};
  return {
    providerPostId: String(data.id || ''),
    providerPostUrl: data.url || ''
  };
}

async function postToDiscord(_credential, delivery) {
  const webhookUrl = String(process.env.SOCIAL_DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(webhookUrl)) {
    throw new Error('Discord webhook URL is not configured');
  }

  const postUrl = String(delivery.postUrl || '').trim();
  const mediaUrl = String(delivery.mediaUrl || '').trim();
  const payload = await fetchJson(`${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: truncateChars(delivery.caption, 2000),
      username: 'Grayson Wills Blog',
      allowed_mentions: { parse: [] },
      embeds: /^https?:\/\//i.test(postUrl) || /^https?:\/\//i.test(mediaUrl)
        ? [{
          title: truncateChars(delivery.title || delivery.postTitle || 'New post', 256),
          url: /^https?:\/\//i.test(postUrl) ? postUrl : undefined,
          image: /^https?:\/\//i.test(mediaUrl) ? { url: mediaUrl } : undefined
        }]
        : []
    })
  });
  const id = String(payload?.id || '');
  return {
    providerPostId: id,
    providerPostUrl: id && payload?.channel_id ? `https://discord.com/channels/@me/${payload.channel_id}/${id}` : ''
  };
}

async function postToGoogle() {
  throw new Error('Google APIs are connected, but Gmail, YouTube, and marketing action workers are not enabled yet.');
}

async function sendDeliveryRecord(delivery, credential = null) {
  const userSub = String(delivery.userSub || '').trim();
  const deliveryId = String(delivery.deliveryId || '').trim();
  if (!userSub || !deliveryId) throw new Error('Delivery identity is missing');

  if (delivery.status === 'sent') return delivery;
  if (delivery.status === 'sending') {
    const err = new Error('Delivery is already sending; refusing a concurrent send');
    err.status = 409;
    throw err;
  }
  if (delivery.status === 'unknown') {
    const err = new Error('Delivery outcome is unknown and requires manual reconciliation');
    err.status = 409;
    throw err;
  }

  if (!POSTING_PROVIDERS.has(delivery.provider)) {
    return updateDelivery(userSub, deliveryId, {
      status: 'failed',
      lastError: `Unsupported social provider: ${delivery.provider}`
    });
  }

  let postingCredential = credential;
  if (delivery.provider !== 'discord' && !postingCredential) {
    try {
      postingCredential = await socialAuth.getPostingCredential(delivery.provider, { sub: userSub });
    } catch (err) {
      return updateDelivery(userSub, deliveryId, {
        status: 'failed',
        lastError: err?.message || 'Provider is not connected'
      });
    }
  }

  const claimed = await claimDeliveryForSend(delivery);
  if (claimed.status === 'sent') return claimed;

  try {
    let result;
    if (delivery.provider === 'discord') {
      result = await postToDiscord(null, delivery);
    } else {
      if (delivery.provider === 'x') result = await postToX(postingCredential, delivery);
      else if (delivery.provider === 'linkedin') result = await postToLinkedIn(postingCredential, delivery);
      else if (delivery.provider === 'facebook') result = await postToFacebook(postingCredential, delivery);
      else if (delivery.provider === 'instagram') result = await postToInstagram(postingCredential, delivery);
      else if (delivery.provider === 'threads') result = await postToThreads(postingCredential, delivery);
      else if (delivery.provider === 'tiktok') result = await postToTikTok(postingCredential, delivery);
      else if (delivery.provider === 'reddit') result = await postToReddit(postingCredential, delivery);
      else if (delivery.provider === 'pinterest') result = await postToPinterest(postingCredential, delivery);
      else if (delivery.provider === 'mastodon') result = await postToMastodon(postingCredential, delivery);
      else if (delivery.provider === 'tumblr') result = await postToTumblr(postingCredential, delivery);
      else if (delivery.provider === 'medium') result = await postToMedium(postingCredential, delivery);
      else if (delivery.provider === 'google') result = await postToGoogle(postingCredential, delivery);
    }

    return await updateDelivery(userSub, deliveryId, {
      status: 'sent',
      providerPostId: result.providerPostId || '',
      providerPostUrl: result.providerPostUrl || '',
      sentAt: nowIso(),
      lastError: ''
    });
  } catch (err) {
    return await updateDelivery(userSub, deliveryId, {
      status: 'unknown',
      lastError: `Provider outcome may be ambiguous; reconcile before retrying: ${err?.message || 'Social post failed'}`
    });
  }
}

async function sendDeliveryById({ userSub, deliveryId, force = false }) {
  const delivery = await getDeliveryById({ userSub, deliveryId });
  if (!delivery) {
    const err = new Error('Delivery not found');
    err.status = 404;
    throw err;
  }
  if (delivery.status === 'sent') {
    return sanitizeDelivery(delivery);
  }
  if (delivery.status === 'sending' || delivery.status === 'unknown') {
    const err = new Error(
      delivery.status === 'unknown'
        ? 'Delivery outcome is unknown and requires manual reconciliation'
        : 'Delivery is already sending; refusing a concurrent send'
    );
    err.status = 409;
    throw err;
  }
  if (delivery.requiresReview && delivery.status === 'needs_review' && !force) {
    const err = new Error('Delivery requires review before posting');
    err.status = 409;
    throw err;
  }
  return sanitizeDelivery(await sendDeliveryRecord(delivery));
}

async function createDeliveryDraftForUser(user, input = {}) {
  const userSub = userSubFrom(user);
  const provider = String(input.provider || input.platformId || '').trim().toLowerCase();
  const caption = String(input.caption || '').trim();
  if (!provider) {
    const err = new Error('provider is required');
    err.status = 400;
    throw err;
  }
  if (!caption) {
    const err = new Error('caption is required');
    err.status = 400;
    throw err;
  }

  let credential = null;
  let lastError = '';
  try {
    credential = await socialAuth.getPostingCredential(provider, { sub: userSub });
  } catch (err) {
    lastError = err?.message || 'Provider is not connected';
  }

  const listItemID = String(input.listItemID || 'manual-social-draft').trim();
  const runAt = input.runAt ? new Date(input.runAt) : new Date();
  if (Number.isNaN(runAt.getTime())) {
    const err = new Error('runAt must be a valid date');
    err.status = 400;
    throw err;
  }

  const deliveryId = String(input.deliveryId || '').trim() || getDeliveryId({
    listItemID,
    trigger: 'mcp_draft',
    ruleId: sha256Hex(caption).slice(0, 16),
    provider,
    accountId: credential?.accountId || credential?.accountLabel || 'unselected'
  });
  const timestamp = nowIso();
  const delivery = {
    ...deliveryKey(userSub, deliveryId),
    type: 'social_delivery',
    deliveryId,
    userSub,
    listItemID,
    trigger: 'mcp_draft',
    ruleId: String(input.ruleId || 'mcp-draft').trim(),
    ruleName: String(input.ruleName || 'MCP delivery draft').trim(),
    templateId: String(input.templateId || 'mcp-custom').trim(),
    templateName: String(input.templateName || 'MCP custom draft').trim(),
    provider,
    accountId: credential?.accountId || '',
    accountLabel: credential?.accountLabel || '',
    destination: String(input.destination || 'Post').trim(),
    caption,
    mediaUrl: String(input.mediaUrl || '').trim(),
    postUrl: String(input.postUrl || '').trim(),
    title: String(input.title || 'MCP social draft').trim(),
    runAt: runAt.toISOString(),
    status: 'draft',
    requiresReview: true,
    quietMode: input.quietMode !== false,
    idempotencyRequestHash: String(input.idempotencyRequestHash || '').trim(),
    lastError,
    attemptCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const saved = await putDeliveryIfAbsent(delivery);
  const savedHash = String(saved.delivery?.idempotencyRequestHash || '').trim();
  if (!saved.created && delivery.idempotencyRequestHash && savedHash !== delivery.idempotencyRequestHash) {
    const err = new Error('Idempotency-Key was reused with a different payload');
    err.status = 409;
    throw err;
  }
  return sanitizeDelivery(saved.delivery || delivery);
}

async function sendDeliveryForUser(user, deliveryId, { force = true } = {}) {
  return sendDeliveryById({
    userSub: userSubFrom(user),
    deliveryId,
    force
  });
}

async function deleteDeliveryForUser(user, deliveryId) {
  const userSub = userSubFrom(user);
  const delivery = await getDeliveryById({ userSub, deliveryId });
  if (!delivery) {
    const err = new Error('Delivery not found');
    err.status = 404;
    throw err;
  }
  if (['sent', 'sending', 'unknown'].includes(String(delivery.status || ''))) {
    const err = new Error(`Cannot delete a ${delivery.status} delivery; preserve it for receipt or reconciliation`);
    err.status = 409;
    throw err;
  }

  if (delivery.scheduleName) {
    const cfg = getSchedulerConfig();
    try {
      await getScheduler().send(new DeleteScheduleCommand({
        GroupName: cfg.schedulerGroupName,
        Name: String(delivery.scheduleName)
      }));
    } catch (err) {
      if (err?.name !== 'ResourceNotFoundException') throw err;
    }
  }

  await getDdbDoc().send(new DeleteCommand({
    TableName: getTableName(),
    Key: deliveryKey(userSub, deliveryId)
  }));

  return { ok: true, deliveryId };
}

async function cancelPendingDeliveriesForPost({ userSub, listItemID } = {}) {
  const normalizedUserSub = String(userSub || '').trim();
  const normalizedListItemID = String(listItemID || '').trim();
  if (!normalizedUserSub || !normalizedListItemID) {
    return { ok: true, deleted: 0, scanned: 0 };
  }

  const { deliveries } = await listDeliveries(normalizedUserSub, { limit: 200 });
  const pending = deliveries.filter((delivery) => (
    delivery.listItemID === normalizedListItemID
    && !['sent', 'sending', 'unknown'].includes(String(delivery.status || ''))
  ));
  let deleted = 0;
  const cfg = getSchedulerConfig();

  for (const delivery of pending) {
    const raw = await getDeliveryById({ userSub: normalizedUserSub, deliveryId: delivery.deliveryId });
    if (raw?.scheduleName) {
      try {
        await getScheduler().send(new DeleteScheduleCommand({
          GroupName: cfg.schedulerGroupName,
          Name: String(raw.scheduleName)
        }));
      } catch (err) {
        if (err?.name !== 'ResourceNotFoundException') throw err;
      }
    }

    await getDdbDoc().send(new DeleteCommand({
      TableName: getTableName(),
      Key: deliveryKey(normalizedUserSub, delivery.deliveryId)
    }));
    deleted++;
  }

  return { ok: true, deleted, scanned: deliveries.length };
}

module.exports = {
  getDefaultSettings,
  normalizeSettings,
  getSettings,
  saveSettings,
  listDeliveries,
  processBlogAutomation,
  createDeliveryDraftForUser,
  scheduleDeliveryAtForUser,
  sendDeliveryById,
  sendDeliveryForUser,
  deleteDeliveryForUser,
  cancelPendingDeliveriesForPost,
  buildBlogContext,
  buildPreviews,
  renderTemplate,
  getDeliveryId,
  sanitizeDelivery,
  getTableName,
  getSchedulerConfig,
  getAwsRegion,
  __private: {
    claimDeliveryForSend,
    safeScheduleName,
    postToX,
    postToLinkedIn,
    postToInstagram,
    postToTikTok,
    postToReddit,
    postToPinterest,
    postToMastodon,
    postToTumblr,
    postToMedium,
    postToGoogle,
    postToDiscord
  }
};
