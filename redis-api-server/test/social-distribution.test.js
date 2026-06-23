const test = require('node:test');
const assert = require('node:assert/strict');

const socialDistribution = require('../src/services/social-distribution');

test('normalizes social distribution settings with default templates and rules', () => {
  const settings = socialDistribution.normalizeSettings({
    templates: [
      {
        id: 'custom',
        name: 'Custom',
        platformId: 'x',
        destination: 'Single post',
        body: '{{title}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      }
    ],
    rules: [
      {
        id: 'custom-rule',
        name: 'Custom rule',
        trigger: 'blog_published',
        enabled: true,
        templateId: 'custom',
        platformIds: ['x'],
        delayMinutes: 0,
        requiresReview: false,
        quietMode: true
      }
    ]
  });

  assert.ok(settings.templates.some((template) => template.id === 'launch-note'));
  assert.ok(settings.templates.some((template) => template.id === 'custom'));
  assert.ok(settings.templates.some((template) => template.id === 'threads-short-post'));
  assert.ok(settings.templates.some((template) => template.id === 'tiktok-photo-upload'));
  assert.ok(settings.rules.some((rule) => rule.id === 'publish-announcement'));
  assert.ok(settings.rules.some((rule) => rule.id === 'custom-rule'));
});

test('renders automation previews with deterministic variables', () => {
  const settings = socialDistribution.normalizeSettings({
    templates: [
      {
        id: 'short',
        name: 'Short',
        platformId: 'x',
        destination: 'Single post',
        body: '{{title}} {{url}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      }
    ],
    rules: [
      {
        id: 'rule',
        name: 'Rule',
        trigger: 'blog_published',
        enabled: true,
        templateId: 'short',
        platformIds: ['x'],
        delayMinutes: 2,
        requiresReview: false,
        quietMode: true
      }
    ]
  });

  const previews = socialDistribution.buildPreviews(settings, {
    title: 'Hello',
    summary: 'Summary',
    url: 'https://example.test/post',
    category: 'Writing',
    tags: '#writing',
    publishedDate: 'Jun 12',
    readingTime: '3 min read',
    coverImage: ''
  }, 'blog_published', new Date('2026-06-12T12:00:00Z'));

  const custom = previews.find((preview) => preview.ruleId === 'rule');
  assert.equal(custom.caption, 'Hello https://example.test/post\n\n#writing');
  assert.equal(custom.runAt.toISOString(), '2026-06-12T12:02:00.000Z');
});

test('builds stable delivery ids from post, rule, provider, and account', () => {
  const first = socialDistribution.getDeliveryId({
    listItemID: 'blog-1',
    trigger: 'blog_published',
    ruleId: 'rule',
    provider: 'x',
    accountId: '123'
  });
  const second = socialDistribution.getDeliveryId({
    listItemID: 'blog-1',
    trigger: 'blog_published',
    ruleId: 'rule',
    provider: 'x',
    accountId: '123'
  });
  const third = socialDistribution.getDeliveryId({
    listItemID: 'blog-1',
    trigger: 'blog_published',
    ruleId: 'rule',
    provider: 'x',
    accountId: '456'
  });

  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.equal(first.length, 64);
});

test('posts X deliveries through current api.x.com endpoint', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({ data: { id: 'tweet-1' } })
    };
  };

  const result = await socialDistribution.__private.postToX({
    token: { access_token: 'x-token' }
  }, {
    caption: 'New post https://example.test'
  });

  assert.equal(result.providerPostId, 'tweet-1');
  assert.equal(result.providerPostUrl, 'https://x.com/i/web/status/tweet-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.x.com/2/tweets');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer x-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: 'New post https://example.test' });
});

test('posts direct Instagram deliveries through graph.instagram.com', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({ id: calls.length === 1 ? 'creation-1' : 'media-1' })
    };
  };

  const result = await socialDistribution.__private.postToInstagram({
    family: 'instagram',
    accountId: '17841400000000000',
    token: { access_token: 'ig-token' }
  }, {
    caption: 'New post',
    destination: 'feed-post',
    mediaUrl: 'https://cdn.example.test/cover.jpg'
  });

  assert.equal(result.providerPostId, 'media-1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://graph.instagram.com/v23.0/17841400000000000/media');
  assert.equal(calls[1].url, 'https://graph.instagram.com/v23.0/17841400000000000/media_publish');
  assert.match(String(calls[0].options.body), /caption=New\+post/);
});

test('uploads TikTok photo deliveries through the Content Posting API', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        data: { publish_id: 'publish-1' },
        error: { code: 'ok', message: '' }
      })
    };
  };

  const result = await socialDistribution.__private.postToTikTok({
    token: { access_token: 'tiktok-token' }
  }, {
    caption: 'New post\n\nhttps://example.test/blog',
    postTitle: 'A thoughtful long-form post',
    mediaUrl: 'https://cdn.example.test/cover.jpg'
  });

  assert.equal(result.providerPostId, 'publish-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://open.tiktokapis.com/v2/post/publish/content/init/');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tiktok-token');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.post_mode, 'MEDIA_UPLOAD');
  assert.equal(body.media_type, 'PHOTO');
  assert.equal(body.post_info.title, 'A thoughtful long-form post');
  assert.equal(body.post_info.description, 'New post\n\nhttps://example.test/blog');
  assert.equal(body.source_info.source, 'PULL_FROM_URL');
  assert.deepEqual(body.source_info.photo_images, ['https://cdn.example.test/cover.jpg']);
});
