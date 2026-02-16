/**
 * AWS Lambda handler (API Gateway HTTP API)
 */

let httpHandler = null;
let redisConnectPromise = null;

function isApiGatewayEvent(event) {
  // API Gateway HTTP API v2.0
  return !!(event && typeof event === 'object' && event.requestContext && event.requestContext.http);
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
  if (redisClient.isOpen) return;
  if (!redisConnectPromise) {
    redisConnectPromise = redisClient.connect();
  }
  await redisConnectPromise;
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

  if (isApiGatewayEvent(event)) {
    await ensureRedisConnected();
    const handler = await getHttpHandler();
    return handler(event, context);
  }

  return await handleInternalEvent(event);
};
