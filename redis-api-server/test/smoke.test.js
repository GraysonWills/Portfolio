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
