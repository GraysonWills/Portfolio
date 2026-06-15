const { GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { CreateScheduleCommand, DeleteScheduleCommand } = require('@aws-sdk/client-scheduler');

const { getDdbDoc, getScheduler, getAwsRegion } = require('./aws/clients');
const socialAuth = require('./social-auth');
const { sha256Hex } = require('../utils/crypto');

const DEFAULT_TABLE = 'portfolio-social-auth';
const DELIVERY_STATUS = new Set(['draft', 'needs_review', 'scheduled', 'sending', 'sent', 'failed', 'skipped']);

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
  return `social-${sha256Hex(String(deliveryId || '')).slice(0, 16)}-${Date.now()}`.slice(0, 64);
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
    attemptCount: Number(item.attemptCount || 0)
  };
}

async function listDeliveries(user, { limit = 100 } = {}) {
  const userSub = userSubFrom(user);
  const res = await getDdbDoc().send(new QueryCommand({
    TableName: getTableName(),
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
  await getScheduler().send(new CreateScheduleCommand({
    Name: scheduleName,
    GroupName: cfg.schedulerGroupName,
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
  }));

  return updateDelivery(delivery.userSub, delivery.deliveryId, {
    status: 'scheduled',
    scheduleName
  });
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
    failed: results.filter((r) => r.status === 'failed').length,
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
  const payload = await fetchJson('https://api.twitter.com/2/tweets', {
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
  const payload = await fetchJson('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author: `urn:li:person:${personId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: delivery.caption },
          shareMediaCategory: 'NONE'
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    })
  });
  const id = String(payload?.id || '');
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

  const created = await postForm(`https://graph.facebook.com/v22.0/${encodeURIComponent(igUserId)}/media`, createPayload);
  const creationId = String(created?.id || '');
  if (!creationId) throw new Error('Instagram did not create a media container');

  const published = await postForm(`https://graph.facebook.com/v22.0/${encodeURIComponent(igUserId)}/media_publish`, {
    access_token: accessToken,
    creation_id: creationId
  });
  const id = String(published?.id || '');
  return {
    providerPostId: id,
    providerPostUrl: ''
  };
}

async function sendDeliveryRecord(delivery, credential = null) {
  const userSub = String(delivery.userSub || '').trim();
  const deliveryId = String(delivery.deliveryId || '').trim();
  if (!userSub || !deliveryId) throw new Error('Delivery identity is missing');

  if (delivery.status === 'sent') return delivery;

  const attempts = Number(delivery.attemptCount || 0) + 1;
  await updateDelivery(userSub, deliveryId, {
    status: 'sending',
    attemptCount: attempts,
    lastError: ''
  });

  try {
    const postingCredential = credential || await socialAuth.getPostingCredential(delivery.provider, { sub: userSub });
    let result;
    if (delivery.provider === 'x') result = await postToX(postingCredential, delivery);
    else if (delivery.provider === 'linkedin') result = await postToLinkedIn(postingCredential, delivery);
    else if (delivery.provider === 'facebook') result = await postToFacebook(postingCredential, delivery);
    else if (delivery.provider === 'instagram') result = await postToInstagram(postingCredential, delivery);
    else throw new Error(`Unsupported social provider: ${delivery.provider}`);

    return await updateDelivery(userSub, deliveryId, {
      status: 'sent',
      providerPostId: result.providerPostId || '',
      providerPostUrl: result.providerPostUrl || '',
      sentAt: nowIso(),
      lastError: ''
    });
  } catch (err) {
    return await updateDelivery(userSub, deliveryId, {
      status: 'failed',
      lastError: err?.message || 'Social post failed'
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
  if (delivery.status === 'sent' && !force) {
    return sanitizeDelivery(delivery);
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
    lastError,
    attemptCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const saved = await putDeliveryIfAbsent(delivery);
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
    && !['sent', 'sending'].includes(String(delivery.status || ''))
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
  getAwsRegion
};
