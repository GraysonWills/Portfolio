const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Safe defaults for app creation
process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.REDIS_PASSWORD = 'test-password';
process.env.REDIS_TLS = 'false';
process.env.ADMIN_API_KEY = 'test-admin-key';

const { createApp } = require('../src/app');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
    server.on('error', reject);
  });
}

test('GET /api/trading-bot/summary returns 503 when feature disabled', async (t) => {
  // Ensure off by default
  delete process.env.TRADING_BOT_API_ENABLED;
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => server.close());
  const { port } = await listen(server);

  const res = await fetch(`http://127.0.0.1:${port}/api/trading-bot/summary`, {
    headers: { 'x-admin-key': 'test-admin-key' },
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.match(body.error, /disabled/);
});

test('GET /api/trading-bot/summary returns 401 without admin key', async (t) => {
  process.env.TRADING_BOT_API_ENABLED = 'true';
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => {
    server.close();
    delete process.env.TRADING_BOT_API_ENABLED;
  });
  const { port } = await listen(server);

  const res = await fetch(`http://127.0.0.1:${port}/api/trading-bot/summary`);
  assert.equal(res.status, 401);
});

test('GET /api/trading-bot/summary returns 401 with wrong admin key', async (t) => {
  process.env.TRADING_BOT_API_ENABLED = 'true';
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => {
    server.close();
    delete process.env.TRADING_BOT_API_ENABLED;
  });
  const { port } = await listen(server);

  const res = await fetch(`http://127.0.0.1:${port}/api/trading-bot/summary`, {
    headers: { 'x-admin-key': 'not-the-key' },
  });
  assert.equal(res.status, 401);
});

test('root endpoint advertises tradingBot route', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  t.after(() => server.close());
  const { port } = await listen(server);

  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.endpoints.tradingBot, 'root should list tradingBot endpoint');
  assert.match(body.endpoints.tradingBot, /trading-bot/);
});
