const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function runIsolated(script, env = {}) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      REDIS_HOST: '',
      REDIS_ENDPOINT: '',
      ...env
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = result.stdout.trim().split('\n').at(-1);
  return JSON.parse(output);
}

test('disabled Redis client does not load the Redis package graph', () => {
  const result = runIsolated(`
    const client = require('./src/config/redis');
    const cached = Object.keys(require.cache);
    console.log(JSON.stringify({
      configured: client.isConfigured,
      redisModules: cached.filter((key) => /node_modules[\\\\/](@redis|redis)[\\\\/]/.test(key)).length
    }));
  `);

  assert.equal(result.configured, false);
  assert.equal(result.redisModules, 0);
});

test('app route modules load only when their mount path is requested', () => {
  const result = runIsolated(`
    const http = require('node:http');
    const path = require('node:path');
    const { createApp } = require('./src/app');
    const app = createApp();
    const loadedRoutes = () => Object.keys(require.cache)
      .filter((key) => /src[\\\\/]routes[\\\\/][^/\\\\]+\\.js$/.test(key))
      .map((key) => path.basename(key))
      .sort();

    (async () => {
      const before = loadedRoutes();
      const server = http.createServer(app);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const port = server.address().port;
      const root = await fetch('http://127.0.0.1:' + port + '/');
      await root.text();
      const afterRoot = loadedRoutes();
      const health = await fetch('http://127.0.0.1:' + port + '/api/health/liveness');
      await health.text();
      const afterHealth = loadedRoutes();
      server.close();
      console.log(JSON.stringify({ before, afterRoot, afterHealth, healthStatus: health.status }));
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `);

  assert.deepEqual(result.before, []);
  assert.deepEqual(result.afterRoot, []);
  assert.deepEqual(result.afterHealth, ['health.js']);
  assert.equal(result.healthStatus, 200);
});

test('scheduled publishing invokes the existing service directly', async (t) => {
  const lambdaPath = require.resolve('../src/lambda');
  const notificationsPath = require.resolve('../src/services/notifications');
  const originalFetch = global.fetch;
  const calls = [];

  delete require.cache[lambdaPath];
  require.cache[notificationsPath] = {
    id: notificationsPath,
    filename: notificationsPath,
    loaded: true,
    exports: {
      publishBlogPostNow: async (input) => {
        calls.push(input);
        return { ok: true, published: true };
      }
    }
  };
  global.fetch = async () => {
    throw new Error('scheduled publishing should not make an HTTP request');
  };

  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[lambdaPath];
    delete require.cache[notificationsPath];
  });

  const { handler } = require(lambdaPath);
  const response = await handler({
    kind: 'publish_blog_post',
    listItemID: 'post-123',
    scheduleName: 'schedule-123',
    sendEmail: false,
    topic: 'major_updates',
    userSub: 'author-123'
  }, {});

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, published: true });
  assert.deepEqual(calls, [{
    listItemID: 'post-123',
    scheduleName: 'schedule-123',
    sendEmail: false,
    topic: 'major_updates',
    userSub: 'author-123'
  }]);
});
