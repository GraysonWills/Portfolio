/**
 * Frontend -> API contract.
 *
 * portfolio-app and redis-api-server ship from one repo through two independent
 * workflows, and nothing else checks that a URL the frontend calls actually
 * exists on the server. That gap shipped three production outages on
 * 2026-07-21: the blog slug resolver and all five discovery feeds were called
 * by the site (and by its SSR renderer, which turns a failed call into a hard
 * 404 with noindex headers) but were never implemented. Both pipelines stayed
 * green for 18 days.
 *
 * This test scrapes every /api/... URL out of the frontend sources and asserts
 * the server does not answer with its app-level "Not found" catch-all. Any
 * other outcome -- 200, 400, 401, 403, a handler's own 404, even a 500 -- means
 * the route is wired up, which is all this test claims to check.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND_ROOT = path.join(__dirname, '..', '..', 'portfolio-app');
const PROBE = 'contract-probe';

// Paths the frontend builds for a non-API origin, or that are served by the SSR
// process itself rather than by this server.
const IGNORED = [
  '/api/discovery/', // bare prefix from the DISCOVERY_PATHS map keys
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, out);
    } else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Collapse a template-literal URL into a concrete probe path.
 * `${this.apiUrl}/content/v3/blog/resolve/${encodeURIComponent(v)}`
 *   -> /api/content/v3/blog/resolve/contract-probe
 */
function templateToPath(source, startIndex) {
  let i = startIndex;
  let out = '';
  while (i < source.length) {
    const ch = source[i];
    if (ch === '`') break;              // end of this template literal
    if (ch === '?' || ch === '#') break; // query/fragment is not part of the route
    if (ch === '$' && source[i + 1] === '{') {
      // Skip a ${...} interpolation, honouring nested braces, and substitute a
      // placeholder segment. A nested template inside it ends the useful part.
      let depth = 0;
      let nestedTemplate = false;
      i += 1;
      for (; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
          depth -= 1;
          if (depth === 0) { i += 1; break; }
        } else if (source[i] === '`') nestedTemplate = true;
      }
      if (nestedTemplate) break; // e.g. `${query ? `?${query}` : ''}` - stop here
      out += PROBE;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function nearestHttpVerb(source, index) {
  const window = source.slice(Math.max(0, index - 300), index);
  const matches = [...window.matchAll(/\.(get|post|put|patch|delete)\s*[<(]/g)];
  if (matches.length) return matches[matches.length - 1][1].toUpperCase();
  if (/fetch\s*\(\s*$/.test(window) || /fetch\s*\(/.test(window)) {
    const method = /method\s*:\s*['"](\w+)['"]/.exec(source.slice(index, index + 400));
    return method ? method[1].toUpperCase() : 'GET';
  }
  return 'GET';
}

/**
 * True when a file's `apiUrl` points at a third party rather than at this
 * server -- mailchimp.service.ts, for example, names its Mailchimp base
 * `apiUrl` too, and its routes are not ours to implement.
 */
function targetsForeignOrigin(source) {
  const declaration = /\bapiUrl\s*(?::\s*string\s*)?=\s*['"`]([^'"`]+)['"`]/.exec(source);
  if (!declaration) return false;
  const value = declaration[1];
  if (!/^https?:\/\//.test(value)) return false;
  return !/localhost|127\.0\.0\.1|grayson-wills/.test(value);
}

function extractApiCalls(file) {
  const source = fs.readFileSync(file, 'utf8');
  const found = new Map();
  const foreign = targetsForeignOrigin(source);

  const record = (routePath, method, index) => {
    let normalized = routePath.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    if (!normalized.startsWith('/api/')) return;
    if (IGNORED.some((ignored) => normalized === ignored.replace(/\/$/, ''))) return;
    const verb = method || nearestHttpVerb(source, index);
    found.set(`${verb} ${normalized}`, { method: verb, path: normalized, file });
  };

  // `${this.apiUrl}/...` and `${apiUrl}/...` - apiUrl is '/api' in prod.
  if (!foreign) {
    const apiUrlRe = /\$\{\s*(?:this\.)?apiUrl\s*\}/g;
    for (const match of source.matchAll(apiUrlRe)) {
      const tail = templateToPath(source, match.index + match[0].length);
      record(`/api${tail}`, null, match.index);
    }
  }

  // server.ts style: `${base}/api/...`
  const baseRe = /\$\{[^}]*\}\/api\//g;
  for (const match of source.matchAll(baseRe)) {
    const tail = templateToPath(source, match.index + match[0].length - 1);
    record(`/api${tail}`, null, match.index);
  }

  // Plain string literals, e.g. the DISCOVERY_PATHS map in server.ts.
  const literalRe = /['"](\/api\/[A-Za-z0-9\-._/]*)['"]/g;
  for (const match of source.matchAll(literalRe)) {
    record(match[1], 'GET', match.index);
  }

  return [...found.values()];
}

test('every API URL the frontend calls exists on this server', async (t) => {
  if (!fs.existsSync(FRONTEND_ROOT)) {
    t.skip('portfolio-app not present in this checkout');
    return;
  }

  const sources = [
    ...walk(path.join(FRONTEND_ROOT, 'src')),
    path.join(FRONTEND_ROOT, 'server.ts')
  ].filter((file) => fs.existsSync(file));

  const calls = new Map();
  for (const file of sources) {
    for (const call of extractApiCalls(file)) {
      calls.set(`${call.method} ${call.path}`, call);
    }
  }

  const targets = [...calls.values()];
  assert.ok(
    targets.length >= 10,
    `expected to scrape a meaningful number of API calls, found ${targets.length} - the extractor is probably broken`
  );

  const previousEnv = { NODE_ENV: process.env.NODE_ENV, REDIS_HOST: process.env.REDIS_HOST };
  process.env.NODE_ENV = 'test';
  process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'undefined') delete process.env[key];
      else process.env[key] = value;
    }
  });

  const { createApp } = require('../src/app');
  const server = http.createServer(createApp());
  t.after(() => server.close());
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function probe(target) {
    let response;
    try {
      response = await fetch(`${baseUrl}${target.path}`, {
        method: target.method,
        headers: { 'content-type': 'application/json' },
        body: ['GET', 'HEAD'].includes(target.method) ? undefined : '{}',
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      return null; // A transport-level failure still means something was listening.
    }

    if (response.status !== 404) return null;

    // Distinguish the app-level catch-all (no such route) from a handler's own
    // 404 (route exists, resource does not). Only the former is a contract break.
    let body;
    try {
      body = await response.json();
    } catch {
      return null;
    }
    if (body && body.error === 'Not found' && typeof body.path === 'string') {
      return `${target.method} ${target.path}  (called from ${path.relative(FRONTEND_ROOT, target.file)})`;
    }
    return null;
  }

  // Probe concurrently; several routes talk to absent backends and only fail
  // after a timeout, which serially would dominate the suite's runtime.
  const missing = [];
  const queue = [...targets];
  const workers = Array.from({ length: 8 }, async () => {
    for (let next = queue.pop(); next; next = queue.pop()) {
      const failure = await probe(next);
      if (failure) missing.push(failure);
    }
  });
  await Promise.all(workers);
  missing.sort();

  assert.deepEqual(
    missing,
    [],
    `The frontend calls API routes that do not exist on this server:\n  ${missing.join('\n  ')}\n\n`
      + 'Implement the route in redis-api-server/src/routes/, or fix the caller. '
      + 'See docs/public-blog-routing-and-discovery.md.'
  );
});
