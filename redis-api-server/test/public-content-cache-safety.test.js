const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const {
  clearPortfolioModuleCache,
  createMemoryDdb,
  installFakeAws
} = require('./mcp-test-utils');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
    server.on('error', reject);
  });
}

function assertNoStore(response) {
  const cacheControl = response.headers.get('cache-control') || '';
  assert.match(cacheControl, /no-store/i);
  assert.match(cacheControl, /s-maxage=0/i);
  assert.doesNotMatch(cacheControl, /(?:^|,)\s*public\b/i);
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
  assert.equal(response.headers.get('surrogate-control'), 'no-store');
}

test('public blog reads enforce visibility and error cache safety', async (t) => {
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    CONTENT_BACKEND: process.env.CONTENT_BACKEND,
    CONTENT_TABLE_NAME: process.env.CONTENT_TABLE_NAME,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_ENDPOINT: process.env.REDIS_ENDPOINT,
    PUBLIC_EDGE_SHARED_SECRET: process.env.PUBLIC_EDGE_SHARED_SECRET,
    PUBLIC_READ_CACHE_CONTROL: process.env.PUBLIC_READ_CACHE_CONTROL
  };

  process.env.NODE_ENV = 'test';
  process.env.CONTENT_BACKEND = 'dynamodb';
  process.env.CONTENT_TABLE_NAME = 'content-cache-safety-test';
  process.env.REDIS_HOST = '';
  process.env.REDIS_ENDPOINT = '';
  process.env.PUBLIC_EDGE_SHARED_SECRET = 'edge-cache-safety-secret';
  process.env.PUBLIC_READ_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

  const memory = createMemoryDdb();
  const tableName = process.env.CONTENT_TABLE_NAME;
  const pastIso = new Date(Date.now() - 86_400_000).toISOString();
  const futureIso = new Date(Date.now() + 86_400_000).toISOString();
  const fixtures = [
    {
      ID: 'visible-meta',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'visible',
      UpdatedAt: pastIso,
      Metadata: {
        title: 'Visible post',
        status: 'published',
        publishDate: pastIso,
        privateSeoTags: ['private-visible-keyword']
      }
    },
    {
      ID: 'visible-image',
      PageID: 3,
      PageContentID: 5,
      ListItemID: 'visible',
      UpdatedAt: pastIso,
      Photo: 'https://media.example.test/visible.webp'
    },
    {
      ID: 'scheduled-meta',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'scheduled',
      UpdatedAt: pastIso,
      Metadata: {
        title: 'Scheduled post',
        status: 'scheduled',
        publishDate: futureIso,
        privateSeoTags: ['private-scheduled-keyword']
      }
    },
    {
      ID: 'scheduled-image',
      PageID: 3,
      PageContentID: 5,
      ListItemID: 'scheduled',
      UpdatedAt: pastIso,
      Photo: 'https://media.example.test/scheduled.webp'
    },
    {
      ID: 'future-meta',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'future',
      UpdatedAt: pastIso,
      Metadata: {
        title: 'Future post marked published',
        status: 'published',
        publishDate: futureIso
      }
    },
    {
      ID: 'future-image',
      PageID: 3,
      PageContentID: 5,
      ListItemID: 'future',
      UpdatedAt: pastIso,
      Photo: 'https://media.example.test/future.webp'
    },
    {
      ID: 'draft-meta',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'draft',
      UpdatedAt: pastIso,
      Metadata: {
        title: 'Draft post',
        status: 'draft',
        publishDate: pastIso
      }
    },
    {
      ID: 'draft-image',
      PageID: 3,
      PageContentID: 5,
      ListItemID: 'draft',
      UpdatedAt: pastIso,
      Photo: 'https://media.example.test/draft.webp'
    },
    {
      ID: 'orphan-image',
      PageID: 3,
      PageContentID: 5,
      ListItemID: 'orphan',
      UpdatedAt: pastIso,
      Photo: 'https://media.example.test/orphan.webp'
    }
  ];

  for (const item of fixtures) {
    await memory.ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  }

  installFakeAws(memory);
  const requireAuthPath = require.resolve('../src/middleware/requireAuth');
  require.cache[requireAuthPath] = {
    id: requireAuthPath,
    filename: requireAuthPath,
    loaded: true,
    exports: (req, res) => res.status(401).json({ error: 'Unauthorized test token' })
  };
  const { createApp } = require('../src/app');
  const server = http.createServer(createApp());
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const edgeHeaders = { 'x-portfolio-edge-secret': process.env.PUBLIC_EDGE_SHARED_SECRET };

  t.after(() => {
    server.close();
    for (const [name, value] of Object.entries(previousEnv)) {
      if (typeof value === 'undefined') delete process.env[name];
      else process.env[name] = value;
    }
    clearPortfolioModuleCache();
  });

  const cardsResponse = await fetch(
    `${baseUrl}/api/content/v2/blog/cards?status=scheduled&includeFuture=true&limit=50`,
    { headers: edgeHeaders }
  );
  assert.equal(cardsResponse.status, 200);
  assert.match(cardsResponse.headers.get('cache-control') || '', /\bpublic\b/i);
  for (const header of ['ratelimit-limit', 'ratelimit-policy', 'ratelimit-remaining', 'ratelimit-reset']) {
    assert.equal(cardsResponse.headers.get(header), null, `${header} must not be cached`);
  }
  const cardsBody = await cardsResponse.json();
  assert.deepEqual(cardsBody.items.map((item) => item.listItemID), ['visible']);
  assert.equal(cardsBody.items[0].status, 'published');
  assert.equal(Object.hasOwn(cardsBody.items[0], 'privateSeoTags'), false);

  const rawContentResponse = await fetch(`${baseUrl}/api/content/`, {
    headers: {
      ...edgeHeaders,
      authorization: 'Bearer arbitrary-unverified-token'
    }
  });
  assert.equal(rawContentResponse.status, 401);
  assertNoStore(rawContentResponse);

  const privateSearchResponse = await fetch(
    `${baseUrl}/api/content/v2/blog/cards?q=private-visible-keyword`,
    { headers: edgeHeaders }
  );
  assert.equal(privateSearchResponse.status, 200);
  const privateSearchBody = await privateSearchResponse.json();
  assert.deepEqual(privateSearchBody.items, []);

  const mediaResponse = await fetch(
    `${baseUrl}/api/content/v2/blog/cards/media?listItemIDs=visible,scheduled,future,draft,orphan`,
    { headers: edgeHeaders }
  );
  assert.equal(mediaResponse.status, 200);
  const mediaBody = await mediaResponse.json();
  assert.deepEqual(mediaBody.items, [{
    listItemID: 'visible',
    imageUrl: 'https://media.example.test/visible.webp'
  }]);

  const missingResponse = await fetch(
    `${baseUrl}/api/content/v3/blog/missing`,
    { headers: edgeHeaders }
  );
  assert.equal(missingResponse.status, 404);
  assertNoStore(missingResponse);

  const forbiddenResponse = await fetch(`${baseUrl}/api/content/v3/blog/missing`);
  assert.equal(forbiddenResponse.status, 403);
  assertNoStore(forbiddenResponse);

  const originalSend = memory.ddb.send.bind(memory.ddb);
  memory.ddb.send = async (command) => {
    const values = command?.input?.ExpressionAttributeValues || {};
    if (command?.constructor?.name === 'QueryCommand' && Number(values[':pid']) === 0) {
      throw new Error('forced public read failure');
    }
    return originalSend(command);
  };

  const failureResponse = await fetch(
    `${baseUrl}/api/content/v3/landing`,
    { headers: edgeHeaders }
  );
  assert.equal(failureResponse.status, 500);
  assertNoStore(failureResponse);
});
