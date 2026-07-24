const crypto = require('crypto');

const socialAuth = require('./social-auth');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_SEARCH_RESULTS = 25;
const MAX_READ_MESSAGES = 20;
const MAX_MESSAGE_TEXT_CHARS = 20_000;
const MAX_DRAFT_BODY_CHARS = 60_000;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

const GMAIL_READ_SCOPES = new Set([
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
]);

const GMAIL_DRAFT_SCOPES = new Set([
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
]);

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

function scopeSet(scopeValue = '') {
  return new Set(String(scopeValue || '')
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean));
}

function requireAnyScope(scopeValue, allowed, action) {
  const granted = scopeSet(scopeValue);
  if (![...allowed].some((scope) => granted.has(scope))) {
    throw httpError(409, `Reconnect Google with a Gmail scope that permits ${action}`);
  }
}

async function googleCredential(user, allowedScopes, action) {
  const credential = await socialAuth.getPostingCredential('google', user);
  requireAnyScope(credential.scope, allowedScopes, action);
  const accessToken = String(credential.token?.access_token || '').trim();
  if (!accessToken) throw httpError(409, 'Google access token is unavailable; reconnect Google');
  return { accessToken, credential };
}

async function readResponseBody(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > maxBytes) throw httpError(502, 'Google response exceeded the configured size limit');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw httpError(502, 'Google response exceeded the configured size limit');
  return bytes;
}

async function fetchGoogleJson(url, accessToken, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const bytes = await readResponseBody(response);
    let payload = {};
    try {
      payload = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
    } catch {
      throw httpError(502, 'Google returned a malformed JSON response');
    }
    if (!response.ok) {
      throw httpError(
        response.status,
        payload?.error?.message || `Google API request failed with HTTP ${response.status}`,
        { code: payload?.error?.code || response.status }
      );
    }
    return payload;
  } catch (err) {
    if (err?.name === 'AbortError') throw httpError(504, 'Google API request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanHeaderValue(value, field, maxLength = 998) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/[\r\n\0]/.test(text)) throw httpError(400, `${field} contains invalid control characters`);
  if (text.length > maxLength) throw httpError(400, `${field} is too long`);
  return text;
}

function cleanMailbox(value, field) {
  const text = cleanHeaderValue(value, field, 320);
  const match = text.match(/(?:^|<)([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>?$/);
  if (!match) throw httpError(400, `${field} must contain a valid email address`);
  return text;
}

function cleanMailboxList(values, field) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value, index) => cleanMailbox(value, `${field}[${index}]`))
    .filter(Boolean)
    .slice(0, 20);
}

function encodeHeader(value) {
  const text = String(value || '');
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrapBase64(bytes) {
  return Buffer.from(bytes).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
}

function sanitizeFilename(value, index) {
  const base = String(value || `attachment-${index + 1}`)
    .replace(/[\r\n\0"\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return base || `attachment-${index + 1}`;
}

function decodeAttachmentData(attachment, index) {
  const data = String(attachment?.dataBase64 || '').replace(/\s+/g, '');
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw httpError(400, `attachments[${index}].dataBase64 is invalid`);
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) {
    throw httpError(400, `attachments[${index}] must be between 1 byte and ${MAX_ATTACHMENT_BYTES} bytes`);
  }
  return bytes;
}

function buildMimeMessage(input = {}) {
  const to = cleanMailboxList(input.to, 'to');
  if (!to.length) throw httpError(400, 'At least one recipient is required');
  const cc = cleanMailboxList(input.cc, 'cc');
  const bcc = cleanMailboxList(input.bcc, 'bcc');
  const subject = cleanHeaderValue(input.subject, 'subject', 500);
  if (!subject) throw httpError(400, 'subject is required');
  const bodyText = String(input.bodyText || '');
  if (!bodyText.trim()) throw httpError(400, 'bodyText is required');
  if (bodyText.length > MAX_DRAFT_BODY_CHARS) throw httpError(400, 'bodyText is too long');

  const replyTo = input.replyTo ? cleanMailbox(input.replyTo, 'replyTo') : '';
  const inReplyTo = input.inReplyTo ? cleanHeaderValue(input.inReplyTo, 'inReplyTo', 998) : '';
  const references = input.references ? cleanHeaderValue(input.references, 'references', 2_000) : '';
  const idempotencyKey = input.idempotencyKey
    ? cleanHeaderValue(input.idempotencyKey, 'idempotencyKey', 500)
    : '';
  const deterministicMessageId = idempotencyKey
    ? `<job-outreach-${crypto.createHash('sha256').update(idempotencyKey).digest('hex')}@drafts.local>`
    : '';
  const attachments = Array.isArray(input.attachments) ? input.attachments.slice(0, 10) : [];
  const decoded = attachments.map((attachment, index) => {
    const bytes = decodeAttachmentData(attachment, index);
    return {
      bytes,
      filename: sanitizeFilename(attachment.filename, index),
      contentType: cleanHeaderValue(attachment.contentType || 'application/octet-stream', `attachments[${index}].contentType`, 120),
    };
  });
  const totalAttachmentBytes = decoded.reduce((sum, attachment) => sum + attachment.bytes.length, 0);
  if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw httpError(400, `Total attachment size exceeds ${MAX_TOTAL_ATTACHMENT_BYTES} bytes`);
  }

  const headers = [
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(', ')}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    ...(deterministicMessageId ? [`Message-ID: ${deterministicMessageId}`] : []),
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
  ];

  if (!decoded.length) {
    return `${headers.join('\r\n')}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapBase64(Buffer.from(bodyText, 'utf8'))}`;
  }

  const boundary = `=_job_outreach_${crypto.randomBytes(18).toString('hex')}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(bodyText, 'utf8')),
  ];
  for (const attachment of decoded) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      wrapBase64(attachment.bytes)
    );
  }
  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (text.length % 4)) % 4);
  return Buffer.from(`${text}${padding}`, 'base64');
}

function headerMap(payload = {}) {
  const headers = {};
  for (const header of payload?.headers || []) {
    const name = String(header?.name || '').trim().toLowerCase();
    if (!name || headers[name] !== undefined) continue;
    headers[name] = String(header?.value || '');
  }
  return headers;
}

function collectMessageParts(part, out = { text: [], html: [], attachments: [] }) {
  if (!part || typeof part !== 'object') return out;
  const mimeType = String(part.mimeType || '').toLowerCase();
  const filename = String(part.filename || '');
  const data = part.body?.data ? fromBase64Url(part.body.data).toString('utf8') : '';
  if (mimeType === 'text/plain' && data) out.text.push(data);
  if (mimeType === 'text/html' && data) out.html.push(data);
  if (filename || part.body?.attachmentId) {
    out.attachments.push({
      filename,
      mimeType,
      size: Number(part.body?.size || 0),
      attachmentId: String(part.body?.attachmentId || ''),
    });
  }
  for (const child of part.parts || []) collectMessageParts(child, out);
  return out;
}

function htmlToText(value) {
  return String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function summarizeMessage(payload = {}, includeBody = false) {
  const headers = headerMap(payload.payload || {});
  const parts = collectMessageParts(payload.payload || {});
  const bodyText = includeBody
    ? String(parts.text.join('\n\n') || htmlToText(parts.html.join('\n\n')) || '').slice(0, MAX_MESSAGE_TEXT_CHARS)
    : '';
  return {
    id: String(payload.id || ''),
    threadId: String(payload.threadId || ''),
    internalDate: payload.internalDate ? new Date(Number(payload.internalDate)).toISOString() : null,
    labelIds: Array.isArray(payload.labelIds) ? payload.labelIds.map(String).slice(0, 30) : [],
    subject: headers.subject || '',
    from: headers.from || '',
    to: headers.to || '',
    cc: headers.cc || '',
    date: headers.date || '',
    messageId: headers['message-id'] || '',
    snippet: String(payload.snippet || '').slice(0, 500),
    ...(includeBody ? {
      bodyText,
      bodyTruncated: bodyText.length >= MAX_MESSAGE_TEXT_CHARS,
      attachments: parts.attachments.slice(0, 20),
    } : {}),
  };
}

async function getMessage(accessToken, id, includeBody = false) {
  const safeId = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{4,200}$/.test(safeId)) throw httpError(400, 'Invalid Gmail message id');
  const url = new URL(`${GMAIL_API_BASE}/messages/${encodeURIComponent(safeId)}`);
  url.searchParams.set('format', includeBody ? 'full' : 'metadata');
  if (!includeBody) {
    for (const header of ['Subject', 'From', 'To', 'Cc', 'Date', 'Message-ID']) {
      url.searchParams.append('metadataHeaders', header);
    }
  }
  return summarizeMessage(await fetchGoogleJson(url.toString(), accessToken), includeBody);
}

async function searchMessages(user, input = {}) {
  const { accessToken } = await googleCredential(user, GMAIL_READ_SCOPES, 'mail search');
  const query = String(input.query || '').trim();
  if (!query) throw httpError(400, 'query is required');
  if (query.length > 1_000) throw httpError(400, 'query is too long');
  const maxResults = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(input.maxResults || 10) || 10));
  const url = new URL(`${GMAIL_API_BASE}/messages`);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(maxResults));
  if (input.pageToken) url.searchParams.set('pageToken', String(input.pageToken).slice(0, 1_000));
  const listing = await fetchGoogleJson(url.toString(), accessToken);
  const ids = (listing.messages || []).map((message) => message.id).filter(Boolean).slice(0, maxResults);
  const messages = await Promise.all(ids.map((id) => getMessage(accessToken, id, false)));
  return {
    messages,
    nextPageToken: listing.nextPageToken || null,
    resultSizeEstimate: Number(listing.resultSizeEstimate || messages.length),
  };
}

async function readMessages(user, input = {}) {
  const { accessToken } = await googleCredential(user, GMAIL_READ_SCOPES, 'message reading');
  const ids = Array.isArray(input.ids) ? [...new Set(input.ids.map(String))].slice(0, MAX_READ_MESSAGES) : [];
  if (!ids.length) throw httpError(400, 'At least one Gmail message id is required');
  return {
    messages: await Promise.all(ids.map((id) => getMessage(accessToken, id, true))),
  };
}

async function createDraft(user, input = {}) {
  const { accessToken } = await googleCredential(user, GMAIL_DRAFT_SCOPES, 'draft creation');
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (idempotencyKey) {
    const digest = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
    const url = new URL(`${GMAIL_API_BASE}/drafts`);
    url.searchParams.set('q', `rfc822msgid:job-outreach-${digest}@drafts.local`);
    url.searchParams.set('maxResults', '1');
    const listing = await fetchGoogleJson(url.toString(), accessToken);
    const existing = listing.drafts?.[0];
    if (existing?.id && existing?.message?.id) {
      return {
        draft: {
          id: String(existing.id),
          messageId: String(existing.message.id),
          threadId: String(existing.message.threadId || ''),
          status: 'draft',
          idempotentReplay: true,
        },
      };
    }
  }
  const mime = buildMimeMessage(input);
  const payload = await fetchGoogleJson(`${GMAIL_API_BASE}/drafts`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        raw: toBase64Url(mime),
        ...(input.threadId ? { threadId: String(input.threadId) } : {}),
      },
    }),
  });
  return {
    draft: {
      id: String(payload.id || ''),
      messageId: String(payload.message?.id || ''),
      threadId: String(payload.message?.threadId || ''),
      status: 'draft',
    },
  };
}

module.exports = {
  GMAIL_DRAFT_SCOPES,
  GMAIL_READ_SCOPES,
  buildMimeMessage,
  createDraft,
  readMessages,
  searchMessages,
  summarizeMessage,
  toBase64Url,
};
