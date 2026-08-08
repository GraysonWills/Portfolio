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

test('discovery feeds enumerate published posts and exclude hidden ones', async (t) => {
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    CONTENT_BACKEND: process.env.CONTENT_BACKEND,
    CONTENT_TABLE_NAME: process.env.CONTENT_TABLE_NAME,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_ENDPOINT: process.env.REDIS_ENDPOINT,
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL
  };

  process.env.NODE_ENV = 'test';
  process.env.CONTENT_BACKEND = 'dynamodb';
  process.env.CONTENT_TABLE_NAME = 'discovery-test';
  process.env.REDIS_HOST = '';
  process.env.REDIS_ENDPOINT = '';
  process.env.PUBLIC_SITE_URL = 'https://www.grayson-wills.com';

  const memory = createMemoryDdb();
  const tableName = process.env.CONTENT_TABLE_NAME;
  const pastIso = new Date(Date.now() - 86_400_000).toISOString();
  const olderIso = new Date(Date.now() - 172_800_000).toISOString();
  const futureIso = new Date(Date.now() + 86_400_000).toISOString();

  const fixtures = [
    {
      ID: 'newest-meta',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'mesh-newest',
      UpdatedAt: pastIso,
      Metadata: {
        title: 'Ampersands & Edge Cases',
        summary: 'A post whose title needs XML escaping.',
        status: 'published',
        publishDate: pastIso,
        category: 'Engineering',
        tags: ['Testing']
      }
    },
    {
      ID: 'older-meta',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'blog-older',
      UpdatedAt: olderIso,
      Metadata: {
        title: 'Older Post',
        summary: 'Published earlier.',
        status: 'published',
        publishDate: olderIso,
        slug: 'custom-stored-slug'
      }
    },
    {
      ID: 'draft-meta',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'blog-draft',
      UpdatedAt: pastIso,
      Metadata: { title: 'Draft Post', status: 'draft', publishDate: pastIso }
    },
    {
      ID: 'future-meta',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'blog-future',
      UpdatedAt: pastIso,
      Metadata: { title: 'Future Post', status: 'published', publishDate: futureIso }
    }
  ];

  for (const item of fixtures) {
    await memory.ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  }

  installFakeAws(memory);
  const { createApp } = require('../src/app');
  const server = http.createServer(createApp());
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(() => {
    server.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'undefined') delete process.env[key];
      else process.env[key] = value;
    }
    clearPortfolioModuleCache();
  });

  // --- sitemap ---
  const sitemapRes = await fetch(`${baseUrl}/api/discovery/sitemap.xml`);
  assert.equal(sitemapRes.status, 200);
  assert.match(sitemapRes.headers.get('content-type') || '', /application\/xml/);
  const sitemap = await sitemapRes.text();

  // Static pages plus every published post.
  for (const path of ['/', '/work', '/projects', '/blog']) {
    assert.ok(
      sitemap.includes(`<loc>https://www.grayson-wills.com${path}</loc>`),
      `sitemap missing static route ${path}`
    );
  }
  // A stored slug wins; otherwise the slug is derived from the title.
  assert.ok(sitemap.includes('/blog/ampersands-and-edge-cases</loc>'), 'missing derived-slug post');
  assert.ok(sitemap.includes('/blog/custom-stored-slug</loc>'), 'missing stored-slug post');
  // Hidden posts must never appear in a crawlable index.
  assert.ok(!sitemap.includes('draft-post'), 'draft leaked into sitemap');
  assert.ok(!sitemap.includes('future-post'), 'future-dated post leaked into sitemap');
  assert.ok(!sitemap.includes('blog-draft'), 'draft id leaked into sitemap');

  // --- rss ---
  const rssRes = await fetch(`${baseUrl}/api/discovery/rss.xml`);
  assert.equal(rssRes.status, 200);
  const rss = await rssRes.text();
  // Raw ampersands would make the feed invalid XML.
  assert.ok(rss.includes('Ampersands &amp; Edge Cases'), 'title not XML-escaped');
  assert.ok(!/<title>[^<]*[^&]& /.test(rss), 'unescaped ampersand in feed');
  assert.ok(!rss.includes('Draft Post'), 'draft leaked into rss');
  // Newest first.
  assert.ok(
    rss.indexOf('Ampersands') < rss.indexOf('Older Post'),
    'rss items not newest-first'
  );

  // --- json feed ---
  const feedRes = await fetch(`${baseUrl}/api/discovery/feed.json`);
  assert.equal(feedRes.status, 200);
  const feed = await feedRes.json();
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[0].url, 'https://www.grayson-wills.com/blog/ampersands-and-edge-cases');
  assert.ok(feed.items.every((item) => item.date_published), 'feed item missing date');

  // --- llms.txt ---
  const llmsRes = await fetch(`${baseUrl}/api/discovery/llms.txt`);
  assert.equal(llmsRes.status, 200);
  const llms = await llmsRes.text();
  assert.ok(llms.includes('# Grayson Wills'));
  assert.ok(llms.includes('/blog/ampersands-and-edge-cases'));
  assert.ok(!llms.includes('Draft Post'), 'draft leaked into llms.txt');

  // --- robots.txt ---
  const robotsRes = await fetch(`${baseUrl}/api/discovery/robots.txt`);
  assert.equal(robotsRes.status, 200);
  const robots = await robotsRes.text();
  assert.ok(robots.includes('Sitemap: https://www.grayson-wills.com/sitemap.xml'));
  assert.ok(robots.includes('Allow: /api/discovery/'));
});
