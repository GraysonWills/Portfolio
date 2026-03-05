const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clampLimit,
  buildBlogCardsFromPageItems,
  filterBlogCards,
  sortBlogCards
} = require('../src/services/content-v2');

test('clampLimit enforces configured bounds', () => {
  assert.equal(clampLimit(undefined, { defaultValue: 12, min: 1, max: 50 }), 12);
  assert.equal(clampLimit(0, { defaultValue: 12, min: 1, max: 50 }), 1);
  assert.equal(clampLimit(1000, { defaultValue: 12, min: 1, max: 50 }), 50);
});

test('blog card filters hide future content when includeFuture=false', () => {
  const futureIso = new Date(Date.now() + 86_400_000).toISOString();
  const cards = buildBlogCardsFromPageItems([
    {
      ID: 'blog-1',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'blog-1',
      UpdatedAt: new Date().toISOString(),
      Metadata: {
        title: 'Future Post',
        summary: 'Scheduled',
        status: 'published',
        publishDate: futureIso,
        tags: []
      }
    }
  ]);

  const filtered = filterBlogCards(cards, { status: 'published', includeFuture: false });
  assert.equal(filtered.length, 0);
});

test('sortBlogCards orders by publish date desc', () => {
  const older = new Date(Date.now() - 86_400_000).toISOString();
  const newer = new Date().toISOString();
  const cards = buildBlogCardsFromPageItems([
    {
      ID: 'a',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'a',
      UpdatedAt: older,
      Metadata: { title: 'Older', status: 'published', publishDate: older }
    },
    {
      ID: 'b',
      PageID: 3,
      PageContentID: 3,
      ListItemID: 'b',
      UpdatedAt: newer,
      Metadata: { title: 'Newer', status: 'published', publishDate: newer }
    }
  ]);

  const sorted = sortBlogCards(cards);
  assert.equal(sorted[0].listItemID, 'b');
  assert.equal(sorted[1].listItemID, 'a');
});

