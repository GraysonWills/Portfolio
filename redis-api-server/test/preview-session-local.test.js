const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
    server.on('error', reject);
  });
}

function loadCreateAppFresh() {
  const modulePaths = [
    require.resolve('../src/app'),
    require.resolve('../src/routes/content'),
    require.resolve('../src/config/redis'),
    require.resolve('../src/middleware/requireAuth')
  ];

  for (const modulePath of modulePaths) {
    delete require.cache[modulePath];
  }

  return require('../src/app').createApp;
}

test('preview sessions fall back to in-memory storage when no backend is configured', async (t) => {
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_ENDPOINT: process.env.REDIS_ENDPOINT,
    DISABLE_AUTH: process.env.DISABLE_AUTH,
    ALLOW_IN_MEMORY_PREVIEW_SESSIONS: process.env.ALLOW_IN_MEMORY_PREVIEW_SESSIONS,
    PREVIEW_SESSIONS_TABLE_NAME: process.env.PREVIEW_SESSIONS_TABLE_NAME
  };

  process.env.NODE_ENV = 'development';
  process.env.DISABLE_AUTH = 'true';
  process.env.REDIS_HOST = '';
  process.env.REDIS_PORT = '';
  process.env.REDIS_PASSWORD = '';
  process.env.REDIS_ENDPOINT = '';
  process.env.ALLOW_IN_MEMORY_PREVIEW_SESSIONS = 'true';
  process.env.PREVIEW_SESSIONS_TABLE_NAME = '';

  const createApp = loadCreateAppFresh();
  const server = http.createServer(createApp());

  t.after(() => {
    server.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    loadCreateAppFresh();
  });

  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const createRes = await fetch(`${baseUrl}/api/content/preview/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      upserts: [
        {
          ID: 'blog-preview-local',
          PageID: 3,
          PageContentID: 18,
          ListItemID: 'blog-preview-local',
          Text: '<p>rough draft</p>'
        }
      ],
      source: 'test-local-preview'
    })
  });

  assert.equal(createRes.status, 201);
  const createBody = await createRes.json();
  assert.ok(typeof createBody.token === 'string' && createBody.token.length > 10);

  const readRes = await fetch(`${baseUrl}/api/content/preview/${createBody.token}`);
  assert.equal(readRes.status, 200);

  const readBody = await readRes.json();
  assert.equal(readBody.source, 'test-local-preview');
  assert.equal(readBody.upserts[0].ID, 'blog-preview-local');
  assert.equal(readBody.upserts[0].PageContentID, 18);
});
