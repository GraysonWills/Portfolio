const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Ensure tests don't require real Redis credentials (CI-safe).
process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.REDIS_PASSWORD = 'test-password';
process.env.REDIS_TLS = 'false';

const { createApp } = require('../src/app');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
    server.on('error', reject);
  });
}

test('GET /api/health/liveness returns alive', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => server.close());

  const address = await listen(server);
  const url = `http://127.0.0.1:${address.port}/api/health/liveness`;

  const res = await fetch(url);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.status, 'alive');
  assert.ok(typeof body.timestamp === 'string');
});

test('GET / returns API metadata', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => server.close());

  const address = await listen(server);
  const url = `http://127.0.0.1:${address.port}/`;

  const res = await fetch(url);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.message, 'Redis API Server');
  assert.ok(body.endpoints);
  assert.ok(body.endpoints.health);
});

test('authenticated API reads do not consume the write rate limit', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => server.close());

  const address = await listen(server);
  const url = `http://127.0.0.1:${address.port}/api/blog/posts/mesh-post`;

  // Opening a post can cause a retry, and the studio may open many posts in a
  // session. None of those GETs should ever hit the stricter 30-write budget.
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const res = await fetch(url);
    assert.notEqual(res.status, 429);
    assert.notEqual(
      (await res.json()).error,
      'Write rate limit exceeded. Please try again later.'
    );
  }
});

test('back-of-shop reads do not consume the write rate limit', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => server.close());

  const address = await listen(server);
  const base = `http://127.0.0.1:${address.port}`;

  // The Subscribers page lists subscribers on every visit and admin status
  // views poll — a session's worth of studio reads must never hit the
  // stricter 30-write budget. (/api/photo-assets shares the same limiter but
  // its requireAuth fetches Cognito JWKS, which this offline env can't do.)
  const readUrls = [
    `${base}/api/notifications/subscribers`,
    `${base}/api/admin/databases`
  ];
  for (let attempt = 0; attempt < 18; attempt += 1) {
    for (const url of readUrls) {
      const res = await fetch(url);
      assert.notEqual(res.status, 429);
      assert.notEqual(
        (await res.json()).error,
        'Write rate limit exceeded. Please try again later.'
      );
    }
  }
});

test('subscription confirm/unsubscribe email links stay on the write budget', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => server.close());

  const address = await listen(server);
  const base = `http://127.0.0.1:${address.port}`;

  // Exhaust the shared write budget with POSTs. The limiter counts requests
  // on entry, so a nonexistent subpath works — it falls through to the JSON
  // 404 without touching any backing service this offline env lacks.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await fetch(`${base}/api/subscriptions/nope`, { method: 'POST' });
  }

  // Confirm links are GETs that mutate subscription state, so unlike the
  // admin reads above they must keep consuming the write budget: with the
  // budget spent, the limiter must reject them before the handler runs.
  const res = await fetch(`${base}/api/subscriptions/confirm?token=invalid`, {
    signal: AbortSignal.timeout(5000)
  });
  assert.equal(res.status, 429);
  assert.equal(
    (await res.json()).error,
    'Write rate limit exceeded. Please try again later.'
  );
});

test('GET /api/resume/download redirects and rate limits repeated requests', async (t) => {
  process.env.PUBLIC_SITE_URL = 'https://www.grayson-wills.com';
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => {
    server.close();
    delete process.env.PUBLIC_SITE_URL;
  });

  const address = await listen(server);
  const url = `http://127.0.0.1:${address.port}/api/resume/download`;

  const first = await fetch(url, { redirect: 'manual' });
  assert.equal(first.status, 302);
  assert.equal(first.headers.get('location'), 'https://www.grayson-wills.com/assets/Grayson_Wills_Resume.docx');

  const second = await fetch(url, { redirect: 'manual' });
  assert.equal(second.status, 429);
});
