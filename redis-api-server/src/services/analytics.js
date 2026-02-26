/**
 * Analytics ingestion + queue/S3 processing.
 *
 * Flow:
 * 1. Public API receives batched client events.
 * 2. Events are normalized and queued to SQS.
 * 3. Lambda consumer writes gzipped NDJSON batches to S3 partition folders.
 */

const crypto = require('crypto');
const zlib = require('zlib');
const { randomUUID } = require('crypto');
const { SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSqs, getAwsRegion } = require('./aws/clients');

const SQS_BATCH_SIZE = 10;
const DEFAULT_MAX_EVENTS_PER_REQUEST = 25;

let s3Client = null;
let s3ClientRegion = '';

function getS3Client(region) {
  if (s3Client && s3ClientRegion === region) return s3Client;
  s3Client = new S3Client({ region });
  s3ClientRegion = region;
  return s3Client;
}

function getConfig() {
  const queueUrl = String(process.env.ANALYTICS_QUEUE_URL || '').trim();
  const queueEnabled = process.env.ANALYTICS_QUEUE_ENABLED !== 'false' && !!queueUrl;
  const s3Bucket = String(process.env.ANALYTICS_S3_BUCKET || '').trim();
  return {
    queueUrl,
    queueEnabled,
    s3Bucket,
    s3Prefix: String(process.env.ANALYTICS_S3_PREFIX || 'events/').replace(/^\/+/, '').replace(/\/?$/, '/'),
    s3Region: String(process.env.ANALYTICS_S3_REGION || process.env.AWS_REGION || getAwsRegion()).trim(),
    defaultSource: String(process.env.ANALYTICS_DEFAULT_SOURCE || 'portfolio-app').trim(),
    maxEventsPerRequest: Math.max(
      1,
      parseInt(process.env.ANALYTICS_MAX_EVENTS_PER_REQUEST || `${DEFAULT_MAX_EVENTS_PER_REQUEST}`, 10) || DEFAULT_MAX_EVENTS_PER_REQUEST
    ),
    ipHashSalt: String(process.env.ANALYTICS_IP_HASH_SALT || '').trim(),
    captureUserAgent: process.env.ANALYTICS_CAPTURE_USER_AGENT !== 'false',
  };
}

function isFifoQueueUrl(queueUrl) {
  return String(queueUrl || '').toLowerCase().endsWith('.fifo');
}

function hashIp(ip, salt) {
  if (!ip) return '';
  const h = crypto.createHash('sha256');
  h.update(String(salt || ''));
  h.update(':');
  h.update(String(ip));
  return h.digest('hex');
}

function safeString(value, maxLen = 256) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeTs(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function sanitizeMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  try {
    // Keep metadata JSON-serializable and bounded.
    const serialized = JSON.stringify(raw);
    if (!serialized) return {};
    const bounded = serialized.length > 4096 ? serialized.slice(0, 4096) : serialized;
    return JSON.parse(bounded);
  } catch {
    return {};
  }
}

function normalizeEvent(raw, requestContext, cfg) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const eventType = safeString(raw.type || raw.eventType, 80);
  if (!eventType) return null;

  const ts = normalizeTs(raw.ts || raw.timestamp || raw.eventTime);
  const iso = ts.toISOString();
  const eventDate = iso.slice(0, 10);
  const eventHour = iso.slice(11, 13);

  const route = safeString(raw.route || requestContext.route, 256);
  const page = safeString(raw.page, 128);
  const source = safeString(raw.source, 64) || cfg.defaultSource;
  const referrer = safeString(raw.referrer || requestContext.referrer, 512);
  const sessionId = safeString(raw.sessionId, 120);
  const visitorId = safeString(raw.visitorId, 120);
  const userAgent = cfg.captureUserAgent ? safeString(requestContext.userAgent, 512) : '';
  const ipHash = hashIp(requestContext.ip, cfg.ipHashSalt);
  const metadata = sanitizeMetadata(raw.metadata);

  return {
    version: 1,
    event_type: eventType,
    event_time: iso,
    event_date: eventDate,
    event_hour: eventHour,
    route,
    page,
    source,
    referrer,
    session_id: sessionId,
    visitor_id: visitorId,
    user_agent: userAgent,
    ip_hash: ipHash,
    metadata,
    metadata_json: JSON.stringify(metadata),
    received_at: new Date().toISOString(),
  };
}

function queueBody(payload) {
  return JSON.stringify({
    type: 'analytics_event',
    createdAt: new Date().toISOString(),
    payload
  });
}

async function enqueueAnalyticsEvents(rawEvents, requestContext = {}) {
  const cfg = getConfig();
  const events = Array.isArray(rawEvents) ? rawEvents : [rawEvents];
  const limited = events.slice(0, cfg.maxEventsPerRequest);
  const normalized = [];
  let rejected = 0;

  for (const e of limited) {
    const n = normalizeEvent(e, requestContext, cfg);
    if (n) normalized.push(n);
    else rejected++;
  }

  if (!normalized.length) {
    return { accepted: 0, queued: 0, rejected, queueEnabled: cfg.queueEnabled };
  }

  if (!cfg.queueEnabled || !cfg.queueUrl) {
    return {
      accepted: normalized.length,
      queued: 0,
      rejected,
      queueEnabled: false,
      reason: 'ANALYTICS_QUEUE_DISABLED'
    };
  }

  const sqs = getSqs();
  const fifo = isFifoQueueUrl(cfg.queueUrl);
  let queued = 0;
  let failed = 0;

  for (let i = 0; i < normalized.length; i += SQS_BATCH_SIZE) {
    const batch = normalized.slice(i, i + SQS_BATCH_SIZE);
    const Entries = batch.map((item, idx) => {
      const absoluteIndex = i + idx;
      const entry = {
        Id: `evt-${absoluteIndex}`,
        MessageBody: queueBody(item)
      };

      if (fifo) {
        const dedup = crypto
          .createHash('sha256')
          .update(`${item.event_type}:${item.event_time}:${item.session_id}:${item.visitor_id}:${absoluteIndex}`)
          .digest('hex');
        entry.MessageGroupId = `analytics-${item.source || 'site'}`.slice(0, 128);
        entry.MessageDeduplicationId = dedup;
      }
      return entry;
    });

    const result = await sqs.send(new SendMessageBatchCommand({
      QueueUrl: cfg.queueUrl,
      Entries
    }));

    const successCount = Array.isArray(result?.Successful) ? result.Successful.length : 0;
    const failedItems = Array.isArray(result?.Failed) ? result.Failed : [];
    queued += successCount;
    failed += failedItems.length;
  }

  return {
    accepted: normalized.length,
    queued,
    failed,
    rejected,
    queueEnabled: true
  };
}

function toPartitionedKey(prefix, eventDate, eventHour) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${prefix}dt=${eventDate}/hr=${eventHour}/batch-${stamp}-${randomUUID()}.json.gz`;
}

function serializeNdjson(records) {
  const lines = records.map((r) => JSON.stringify(r));
  return `${lines.join('\n')}\n`;
}

async function writeGroupedEventsToS3(events) {
  const cfg = getConfig();
  if (!cfg.s3Bucket) {
    throw new Error('ANALYTICS_S3_BUCKET is not configured');
  }

  const grouped = new Map();
  for (const event of events) {
    const dt = safeString(event.event_date, 10) || new Date().toISOString().slice(0, 10);
    const hr = safeString(event.event_hour, 2) || new Date().toISOString().slice(11, 13);
    const k = `${dt}|${hr}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(event);
  }

  const s3 = getS3Client(cfg.s3Region);
  const writes = [];
  let written = 0;

  for (const [groupKey, records] of grouped.entries()) {
    const [dt, hr] = groupKey.split('|');
    const key = toPartitionedKey(cfg.s3Prefix, dt, hr);
    const body = zlib.gzipSync(Buffer.from(serializeNdjson(records), 'utf8'));

    writes.push(
      s3.send(new PutObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: key,
        Body: body,
        ContentType: 'application/x-ndjson',
        ContentEncoding: 'gzip',
        ServerSideEncryption: 'AES256'
      }))
    );
    written += records.length;
  }

  await Promise.all(writes);
  return { written, files: grouped.size };
}

async function processAnalyticsQueueRecords(records) {
  const failures = [];
  const events = [];
  const acceptedMessageIds = [];

  for (const record of records || []) {
    const messageId = String(record?.messageId || record?.messageID || '').trim();
    try {
      const body = typeof record?.body === 'string' ? JSON.parse(record.body) : record?.body;
      const type = safeString(body?.type, 64);
      if (type !== 'analytics_event') {
        // This processor only handles analytics messages.
        continue;
      }

      const payload = body?.payload;
      if (!payload || typeof payload !== 'object') {
        throw new Error('Missing analytics payload');
      }
      events.push(payload);
      if (messageId) acceptedMessageIds.push(messageId);
    } catch (err) {
      if (messageId) failures.push({ itemIdentifier: messageId });
    }
  }

  if (!events.length) {
    return { ok: failures.length === 0, processed: 0, failed: failures.length, batchItemFailures: failures };
  }

  try {
    await writeGroupedEventsToS3(events);
  } catch (err) {
    for (const id of acceptedMessageIds) failures.push({ itemIdentifier: id });
  }

  // De-duplicate item identifiers for SQS partial batch responses.
  const dedup = new Map();
  for (const f of failures) dedup.set(f.itemIdentifier, f);
  const batchItemFailures = Array.from(dedup.values());

  return {
    ok: batchItemFailures.length === 0,
    processed: events.length,
    failed: batchItemFailures.length,
    batchItemFailures
  };
}

module.exports = {
  getConfig,
  enqueueAnalyticsEvents,
  processAnalyticsQueueRecords,
};
