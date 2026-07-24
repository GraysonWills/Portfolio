const { sha256Hex } = require('../utils/crypto');
const socialAuth = require('./social-auth');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const FILE_SCOPE = 'Files.ReadWrite';

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

function getTrackerConfig() {
  const driveId = String(process.env.JOB_TRACKER_DRIVE_ID || '').trim();
  const itemId = String(process.env.JOB_TRACKER_ITEM_ID || '').trim();
  if (!driveId || !itemId) {
    throw httpError(503, 'JOB_TRACKER_DRIVE_ID and JOB_TRACKER_ITEM_ID are required');
  }
  return { driveId, itemId };
}

async function microsoftCredential(user) {
  const credential = await socialAuth.getPostingCredential('microsoft', user);
  const scopes = scopeSet(credential.scope);
  if (!scopes.has(FILE_SCOPE) && !scopes.has('Files.ReadWrite.All')) {
    throw httpError(409, 'Reconnect Microsoft with Files.ReadWrite permission');
  }
  const accessToken = String(credential.token?.access_token || '').trim();
  if (!accessToken) throw httpError(409, 'Microsoft access token is unavailable; reconnect Microsoft');
  return { accessToken, credential };
}

function trackerItemUrl(config, suffix = '') {
  return `${GRAPH_BASE}/drives/${encodeURIComponent(config.driveId)}/items/${encodeURIComponent(config.itemId)}${suffix}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw httpError(504, 'Microsoft Graph request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function responseBytes(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > maxBytes) throw httpError(502, 'Microsoft Graph response exceeded the configured size limit');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw httpError(502, 'Microsoft Graph response exceeded the configured size limit');
  return bytes;
}

async function graphJson(url, accessToken, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const bytes = await responseBytes(response, MAX_JSON_BYTES);
  let payload = {};
  try {
    payload = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
  } catch {
    throw httpError(502, 'Microsoft Graph returned malformed JSON');
  }
  if (!response.ok) {
    throw httpError(
      response.status,
      payload?.error?.message || `Microsoft Graph request failed with HTTP ${response.status}`,
      { code: payload?.error?.code || '' }
    );
  }
  return payload;
}

function publicMetadata(item = {}) {
  return {
    id: String(item.id || ''),
    name: String(item.name || ''),
    size: Number(item.size || 0),
    eTag: String(item.eTag || ''),
    cTag: String(item.cTag || ''),
    lastModifiedDateTime: item.lastModifiedDateTime || null,
    webUrl: item.webUrl || '',
    mimeType: item.file?.mimeType || '',
  };
}

async function getMetadata(accessToken, config) {
  const url = new URL(trackerItemUrl(config));
  url.searchParams.set('$select', 'id,name,size,eTag,cTag,lastModifiedDateTime,webUrl,file');
  const item = await graphJson(url.toString(), accessToken);
  const metadata = publicMetadata(item);
  if (!metadata.name.toLowerCase().endsWith('.xlsx')) throw httpError(409, 'Configured job tracker is not an .xlsx workbook');
  if (!metadata.eTag) throw httpError(502, 'Microsoft Graph did not return an ETag for the job tracker');
  if (metadata.size > MAX_WORKBOOK_BYTES) throw httpError(409, 'Configured job tracker exceeds the allowed size');
  return metadata;
}

function assertXlsx(bytes) {
  if (!Buffer.isBuffer(bytes)
    || bytes.length < 4
    || bytes[0] !== 0x50
    || bytes[1] !== 0x4b
    || bytes[2] !== 0x03
    || bytes[3] !== 0x04) {
    throw httpError(400, 'Workbook payload is not an Office Open XML .xlsx file');
  }
  if (bytes.length > MAX_WORKBOOK_BYTES) throw httpError(400, 'Workbook payload exceeds the allowed size');
}

async function downloadTracker(user) {
  const { accessToken } = await microsoftCredential(user);
  const config = getTrackerConfig();
  const metadata = await getMetadata(accessToken, config);
  const response = await fetchWithTimeout(trackerItemUrl(config, '/content'), {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  });
  if (!response.ok) {
    const bytes = await responseBytes(response, MAX_JSON_BYTES);
    let message = `Microsoft Graph download failed with HTTP ${response.status}`;
    try {
      const payload = JSON.parse(bytes.toString('utf8'));
      message = payload?.error?.message || message;
    } catch {
      // Keep the bounded status-only message.
    }
    throw httpError(response.status, message);
  }
  const workbook = await responseBytes(response, MAX_WORKBOOK_BYTES);
  assertXlsx(workbook);
  return {
    workbook: {
      ...metadata,
      sha256: sha256Hex(workbook),
      dataBase64: workbook.toString('base64'),
    },
  };
}

function decodeWorkbook(input = {}) {
  const data = String(input.dataBase64 || '').replace(/\s+/g, '');
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw httpError(400, 'dataBase64 is invalid');
  const bytes = Buffer.from(data, 'base64');
  assertXlsx(bytes);
  const checksum = sha256Hex(bytes);
  if (input.sha256 && String(input.sha256).toLowerCase() !== checksum) {
    throw httpError(400, 'Workbook checksum does not match sha256');
  }
  return { bytes, checksum };
}

async function replaceTracker(user, input = {}) {
  const expectedETag = String(input.expectedETag || '').trim();
  if (!expectedETag) throw httpError(400, 'expectedETag is required');
  const { bytes, checksum } = decodeWorkbook(input);
  const { accessToken } = await microsoftCredential(user);
  const config = getTrackerConfig();
  const current = await getMetadata(accessToken, config);
  if (current.eTag !== expectedETag) {
    throw httpError(409, 'Job tracker changed after it was read; download the latest workbook and reconcile', {
      expectedETag,
      currentETag: current.eTag,
    });
  }

  const session = await graphJson(trackerItemUrl(config, '/createUploadSession'), accessToken, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': expectedETag,
    },
    body: JSON.stringify({
      item: {
        '@microsoft.graph.conflictBehavior': 'replace',
        fileSize: bytes.length,
      },
    }),
  });
  const uploadUrl = String(session.uploadUrl || '');
  if (!/^https:\/\//i.test(uploadUrl)) throw httpError(502, 'Microsoft Graph did not return a valid upload session');

  const response = await fetchWithTimeout(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(bytes.length),
      'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    body: bytes,
  });
  const responseBody = await responseBytes(response, MAX_JSON_BYTES);
  let item = {};
  try {
    item = responseBody.length ? JSON.parse(responseBody.toString('utf8')) : {};
  } catch {
    throw httpError(502, 'Microsoft Graph returned malformed upload metadata');
  }
  if (!response.ok || ![200, 201].includes(response.status)) {
    const status = response.status === 412 ? 409 : response.status;
    throw httpError(status === 202 ? 502 : status, item?.error?.message || `Microsoft Graph upload did not complete (HTTP ${response.status})`, {
      code: item?.error?.code || '',
    });
  }
  if (!item.id || !item.eTag) throw httpError(502, 'Microsoft Graph upload completed without final item metadata');
  return {
    workbook: {
      ...publicMetadata(item),
      sha256: checksum,
      previousETag: expectedETag,
    },
  };
}

module.exports = {
  MAX_WORKBOOK_BYTES,
  decodeWorkbook,
  downloadTracker,
  getTrackerConfig,
  publicMetadata,
  replaceTracker,
};
