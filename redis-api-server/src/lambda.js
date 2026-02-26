/**
 * AWS Lambda handler (API Gateway HTTP API)
 */

let httpHandler = null;
let redisConnectPromise = null;

function isApiGatewayEvent(event) {
  // API Gateway HTTP API v2.0
  return !!(event && typeof event === 'object' && event.requestContext && event.requestContext.http);
}

function isSnsEvent(event) {
  const records = event?.Records;
  if (!Array.isArray(records) || !records.length) return false;
  const src = records[0]?.EventSource || records[0]?.eventSource;
  return src === 'aws:sns';
}

function isSqsEvent(event) {
  const records = event?.Records;
  if (!Array.isArray(records) || !records.length) return false;
  const src = records[0]?.eventSource || records[0]?.EventSource;
  return src === 'aws:sqs';
}

async function getHttpHandler() {
  if (httpHandler) return httpHandler;

  // Lazily require app + serverless wrapper so scheduler invocations don't
  // require Redis env vars.
  // eslint-disable-next-line global-require
  const serverless = require('serverless-http');
  // eslint-disable-next-line global-require
  const { createApp } = require('./app');

  const app = createApp();
  httpHandler = serverless(app);
  return httpHandler;
}

async function ensureRedisConnected() {
  // eslint-disable-next-line global-require
  const redisClient = require('./config/redis');
  if (!redisClient.isConfigured) return;
  if (redisClient.isOpen) return;
  if (!redisConnectPromise) {
    redisConnectPromise = redisClient.connect();
  }
  await redisConnectPromise;
}

async function handleSnsEvent(rawEvent) {
  // Lazily require AWS SDK pieces to keep cold starts small for scheduler invokes.
  // eslint-disable-next-line global-require
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  // eslint-disable-next-line global-require
  const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
  // eslint-disable-next-line global-require
  const { sha256Hex, normalizeEmail, maskEmail } = require('./utils/crypto');

  const subscribersTable = process.env.SUBSCRIBERS_TABLE_NAME || 'portfolio-email-subscribers';
  const ddbRegion = process.env.DDB_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-2';
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ddbRegion }), {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: true
    }
  });

  const nowIso = new Date().toISOString();
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  const records = Array.isArray(rawEvent?.Records) ? rawEvent.Records : [];
  for (const r of records) {
    const msgRaw = r?.Sns?.Message || r?.sns?.Message || '';
    let msg = null;
    try {
      msg = JSON.parse(String(msgRaw || ''));
    } catch {
      skipped++;
      continue;
    }

    const type = String(msg?.notificationType || msg?.eventType || '').toLowerCase();
    const mailTs = msg?.mail?.timestamp || null;
    const sesMessageId = msg?.mail?.messageId || null;

    let status = null;
    let emails = [];
    let extra = {};

    if (type === 'bounce') {
      status = 'BOUNCED';
      const recs = Array.isArray(msg?.bounce?.bouncedRecipients) ? msg.bounce.bouncedRecipients : [];
      emails = recs.map(x => x?.emailAddress).filter(Boolean);
      extra = {
        bounceAt: msg?.bounce?.timestamp || mailTs || nowIso,
        bounceType: msg?.bounce?.bounceType || null,
        bounceSubType: msg?.bounce?.bounceSubType || null,
        sesMessageId
      };
    } else if (type === 'complaint') {
      status = 'COMPLAINED';
      const recs = Array.isArray(msg?.complaint?.complainedRecipients) ? msg.complaint.complainedRecipients : [];
      emails = recs.map(x => x?.emailAddress).filter(Boolean);
      extra = {
        complaintAt: msg?.complaint?.timestamp || mailTs || nowIso,
        complaintFeedbackType: msg?.complaint?.complaintFeedbackType || null,
        sesMessageId
      };
    } else {
      // Ignore deliveries/opens/clicks/etc until we decide to store metrics.
      skipped++;
      continue;
    }

    for (const e of emails) {
      processed++;
      const normalized = normalizeEmail(e);
      const emailHash = sha256Hex(normalized);

      try {
        const exprNames = {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#lastSesEventAt': 'lastSesEventAt',
          '#lastSesEventType': 'lastSesEventType',
          '#lastSesMessageId': 'lastSesMessageId'
        };
        const exprValues = {
          ':s': status,
          ':now': nowIso,
          ':t': status,
          ':mid': sesMessageId
        };
        const sets = [
          '#status = :s',
          '#updatedAt = :now',
          '#lastSesEventAt = :now',
          '#lastSesEventType = :t',
          '#lastSesMessageId = :mid'
        ];

        if (status === 'BOUNCED') {
          exprNames['#bounceAt'] = 'bounceAt';
          exprNames['#bounceType'] = 'bounceType';
          exprNames['#bounceSubType'] = 'bounceSubType';
          exprValues[':bounceAt'] = extra.bounceAt;
          exprValues[':bounceType'] = extra.bounceType;
          exprValues[':bounceSubType'] = extra.bounceSubType;
          sets.push('#bounceAt = if_not_exists(#bounceAt, :bounceAt)');
          sets.push('#bounceType = if_not_exists(#bounceType, :bounceType)');
          sets.push('#bounceSubType = if_not_exists(#bounceSubType, :bounceSubType)');
        }

        if (status === 'COMPLAINED') {
          exprNames['#complaintAt'] = 'complaintAt';
          exprNames['#complaintFeedbackType'] = 'complaintFeedbackType';
          exprValues[':complaintAt'] = extra.complaintAt;
          exprValues[':complaintFeedbackType'] = extra.complaintFeedbackType;
          sets.push('#complaintAt = if_not_exists(#complaintAt, :complaintAt)');
          sets.push('#complaintFeedbackType = if_not_exists(#complaintFeedbackType, :complaintFeedbackType)');
        }

        await ddb.send(new UpdateCommand({
          TableName: subscribersTable,
          Key: { emailHash },
          ConditionExpression: 'attribute_exists(emailHash)',
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues
        }));
        updated++;
      } catch (err) {
        // If the subscriber doesn't exist in our list, ignore.
        if (err?.name === 'ConditionalCheckFailedException') {
          skipped++;
          continue;
        }
        console.error('[sns] Failed to update subscriber:', {
          email: maskEmail(normalized),
          message: String(err?.message || err)
        });
        skipped++;
      }
    }
  }

  return {
    ok: true,
    processed,
    updated,
    skipped
  };
}

async function handleSqsEvent(rawEvent) {
  const records = Array.isArray(rawEvent?.Records) ? rawEvent.Records : [];
  if (!records.length) {
    return { batchItemFailures: [] };
  }

  // Lazy load to avoid pulling queue processors on HTTP-only invocations.
  // eslint-disable-next-line global-require
  const { processNotificationQueueRecords } = require('./services/notifications');
  // eslint-disable-next-line global-require
  const { processAnalyticsQueueRecords } = require('./services/analytics');

  const notificationRecords = [];
  const analyticsRecords = [];
  const invalidRecords = [];

  for (const record of records) {
    const messageId = String(record?.messageId || record?.messageID || '').trim();
    try {
      const body = typeof record?.body === 'string' ? JSON.parse(record.body) : record?.body;
      const type = String(body?.type || '').trim();
      if (type === 'blog_post_notification') {
        notificationRecords.push(record);
      } else if (type === 'analytics_event') {
        analyticsRecords.push(record);
      } else if (messageId) {
        // Unknown message shapes are treated as failures so they can be moved to DLQ.
        invalidRecords.push({ itemIdentifier: messageId });
      }
    } catch {
      if (messageId) invalidRecords.push({ itemIdentifier: messageId });
    }
  }

  const failures = [...invalidRecords];
  if (notificationRecords.length) {
    const out = await processNotificationQueueRecords(notificationRecords);
    failures.push(...(out.batchItemFailures || []));
  }
  if (analyticsRecords.length) {
    const out = await processAnalyticsQueueRecords(analyticsRecords);
    failures.push(...(out.batchItemFailures || []));
  }

  const dedup = new Map();
  for (const f of failures) dedup.set(f.itemIdentifier, f);

  const out = {
    batchItemFailures: Array.from(dedup.values())
  };
  return {
    batchItemFailures: out.batchItemFailures || []
  };
}

async function handleInternalEvent(rawEvent) {
  let event = rawEvent;
  if (typeof event === 'string') {
    try {
      event = JSON.parse(event);
    } catch {
      // leave as-is
    }
  }

  if (!event || typeof event !== 'object') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid event' }) };
  }

  if (event.kind === 'publish_blog_post') {
    const { listItemID, sendEmail, topic } = event;
    if (!listItemID) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing listItemID' }) };
    }

    const url = process.env.SCHEDULER_WEBHOOK_URL || 'https://api.grayson-wills.com/api/notifications/worker/publish';
    const secret = process.env.SCHEDULER_WEBHOOK_SECRET || '';
    if (!secret) {
      return { statusCode: 500, body: JSON.stringify({ error: 'SCHEDULER_WEBHOOK_SECRET not configured' }) };
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scheduler-Secret': secret
      },
      body: JSON.stringify({
        listItemID,
        sendEmail: sendEmail !== false,
        topic: topic || 'blog_posts'
      })
    });

    const text = await resp.text();
    return {
      statusCode: resp.status,
      body: text || JSON.stringify({ ok: resp.ok })
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown event kind' }) };
}

module.exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  if (isSnsEvent(event)) {
    return await handleSnsEvent(event);
  }

  if (isSqsEvent(event)) {
    return await handleSqsEvent(event);
  }

  if (isApiGatewayEvent(event)) {
    await ensureRedisConnected();
    const handler = await getHttpHandler();
    return handler(event, context);
  }

  return await handleInternalEvent(event);
};
