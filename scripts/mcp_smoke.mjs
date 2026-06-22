#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';

const MODES = new Set(['local-contract', 'sandbox-e2e', 'prod-smoke']);

function parseArgs(argv) {
  const args = {
    mode: 'local-contract',
    readOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') {
      args.mode = argv[++i] || args.mode;
    } else if (arg.startsWith('--mode=')) {
      args.mode = arg.slice('--mode='.length);
    } else if (arg === '--read-only') {
      args.readOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!MODES.has(args.mode)) {
    throw new Error(`Invalid --mode "${args.mode}". Expected one of: ${Array.from(MODES).join(', ')}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/mcp_smoke.mjs [--mode local-contract|sandbox-e2e|prod-smoke] [--read-only]',
    '',
    'Token lookup order:',
    '  1. MCP_BEARER_TOKEN',
    '  2. macOS Keychain generic password',
    '     service: MCP_KEYCHAIN_SERVICE or portfolio-mcp-authoring',
    '     account: MCP_KEYCHAIN_ACCOUNT or current hostname',
    '',
    'Endpoint defaults:',
    '  local-contract: MCP_BASE_URL or http://127.0.0.1:3000/api/mcp',
    '  sandbox-e2e:    MCP_BASE_URL is required',
    '  prod-smoke:     MCP_BASE_URL or https://api.grayson-wills.com/api/mcp',
  ].join('\n');
}

function endpointForMode(mode) {
  if (process.env.MCP_BASE_URL) return process.env.MCP_BASE_URL.replace(/\/+$/, '');
  if (mode === 'local-contract') return 'http://127.0.0.1:3000/api/mcp';
  if (mode === 'prod-smoke') return 'https://api.grayson-wills.com/api/mcp';
  throw new Error('MCP_BASE_URL is required for sandbox-e2e mode');
}

function tokenFromKeychain() {
  if (process.platform !== 'darwin') return '';
  const service = process.env.MCP_KEYCHAIN_SERVICE || 'portfolio-mcp-authoring';
  const account = process.env.MCP_KEYCHAIN_ACCOUNT || os.hostname();
  try {
    return execFileSync('security', [
      'find-generic-password',
      '-s',
      service,
      '-a',
      account,
      '-w',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function loadToken() {
  const token = String(process.env.MCP_BEARER_TOKEN || '').trim() || tokenFromKeychain();
  if (!token) {
    throw new Error('No MCP token found. Set MCP_BEARER_TOKEN or add a keychain generic password.');
  }
  if (!token.startsWith('mcp_')) {
    throw new Error('Configured MCP token does not have the expected mcp_ prefix.');
  }
  return token;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function rpc(endpoint, token, method, params = {}) {
  const id = crypto.randomUUID();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${method} failed with HTTP ${response.status}: ${body?.error || body?.error?.message || response.statusText}`);
  }
  if (body?.error) {
    throw new Error(`${method} JSON-RPC error: ${body.error.message || JSON.stringify(body.error)}`);
  }
  return body?.result;
}

async function callTool(endpoint, token, name, args = {}) {
  const result = await rpc(endpoint, token, 'tools/call', {
    name,
    arguments: args,
  });
  return result?.structuredContent || {};
}

async function cleanupDraft(endpoint, token, listItemID, version) {
  if (!listItemID) return;
  try {
    await callTool(endpoint, token, 'blog.delete_mcp_draft', {
      listItemID,
      ...(Number.isFinite(Number(version)) ? { expectedVersion: Number(version) } : {}),
      idempotencyKey: `${listItemID}:cleanup`,
    });
    log(`cleanup: deleted disposable draft ${listItemID}`);
  } catch (err) {
    log(`cleanup: unable to delete disposable draft ${listItemID}: ${err.message}`);
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    log(usage());
    return;
  }

  const endpoint = endpointForMode(args.mode);
  const token = loadToken();
  const readOnly = args.readOnly || String(process.env.MCP_SMOKE_READ_ONLY || '').toLowerCase() === 'true';

  log(`MCP smoke: mode=${args.mode} endpoint=${endpoint}`);
  await rpc(endpoint, token, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {
      name: 'portfolio-mcp-smoke',
      version: '1.0.0',
    },
  });
  log('ok: initialize');

  const listResult = await rpc(endpoint, token, 'tools/list');
  const tools = new Set((listResult?.tools || []).map((tool) => tool.name));
  const requiredTools = [
    'site.get_inventory',
    'blog.list_posts',
    ...(!readOnly ? ['blog.create_draft', 'blog.update_mcp_draft', 'blog.delete_mcp_draft'] : []),
  ];
  for (const required of requiredTools) {
    if (!tools.has(required)) throw new Error(`Required MCP tool is missing: ${required}`);
  }
  log(`ok: tools/list (${tools.size} tools)`);

  await callTool(endpoint, token, 'site.get_inventory');
  log('ok: site.get_inventory');

  await callTool(endpoint, token, 'blog.list_posts', { status: 'all', limit: 3 });
  log('ok: blog.list_posts');

  if (readOnly) {
    log('ok: read-only smoke complete');
    return;
  }

  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const listItemID = `mcp-smoke-${suffix}`;
  let currentVersion = null;
  let shouldCleanup = false;

  try {
    const created = await callTool(endpoint, token, 'blog.create_draft', {
      listItemID,
      title: `MCP smoke draft ${suffix}`,
      summary: 'Disposable MCP smoke draft. Safe to delete.',
      contentMarkdown: 'This is a disposable MCP smoke-test draft.',
      tags: ['mcp-smoke'],
      category: 'Testing',
      idempotencyKey: `${listItemID}:create`,
    });
    currentVersion = created.post?.version;
    shouldCleanup = true;
    log(`ok: blog.create_draft ${listItemID}`);

    const updated = await callTool(endpoint, token, 'blog.update_mcp_draft', {
      listItemID,
      summary: 'Updated disposable MCP smoke draft. Safe to delete.',
      expectedVersion: currentVersion,
      idempotencyKey: `${listItemID}:update`,
    });
    currentVersion = updated.post?.version;
    log(`ok: blog.update_mcp_draft ${listItemID}`);

    await cleanupDraft(endpoint, token, listItemID, currentVersion);
    shouldCleanup = false;
    log('ok: mutation smoke complete');
  } finally {
    if (shouldCleanup) {
      await cleanupDraft(endpoint, token, listItemID, currentVersion);
    }
  }
}

run().catch((err) => {
  process.stderr.write(`MCP smoke failed: ${err.message}\n`);
  process.exit(1);
});
