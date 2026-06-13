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
