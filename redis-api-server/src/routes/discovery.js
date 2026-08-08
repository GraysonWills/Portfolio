/**
 * Discovery Routes
 *
 * Machine-readable indexes of the public site: sitemap, RSS, JSON Feed, and an
 * llms.txt for model crawlers. portfolio-app/server.ts maps the public paths
 * (/sitemap.xml, /rss.xml, /feed.json, /llms.txt, /robots.txt) onto these, so
 * anything missing here surfaces as a 404 on a public URL.
 *
 * These must be generated rather than shipped as static files: posts publish
 * on their own schedule, with no site rebuild to regenerate a checked-in
 * sitemap.
 */

const express = require('express');
const router = express.Router();

const {
  BLOG_PAGE_ID,
  BLOG_ITEM_CONTENT_ID,
  buildBlogCardsFromPageItems,
  filterBlogCards,
  sortBlogCards
} = require('../services/content-v2');
const { readContentByPageAndContent } = require('../services/content-source');

const MAX_FEED_ITEMS = 50;

// Static routes the public site always exposes, with a crawl priority hint.
const STATIC_ROUTES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/work', changefreq: 'monthly', priority: '0.8' },
  { path: '/projects', changefreq: 'monthly', priority: '0.8' },
  { path: '/blog', changefreq: 'weekly', priority: '0.9' }
];

function siteOrigin() {
  return String(process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, '');
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(value) {
  const ts = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null;
}

function toRfc822(value) {
  const iso = toIsoDate(value);
  return iso ? new Date(iso).toUTCString() : null;
}

/**
 * Published, non-future blog posts, newest first. Visibility comes from the
 * same helpers the public cards feed uses, so a draft can never leak into a
 * feed by way of a divergent filter.
 */
async function loadPublishedPosts() {
  const items = await readContentByPageAndContent(BLOG_PAGE_ID, BLOG_ITEM_CONTENT_ID);
  const visible = filterBlogCards(buildBlogCardsFromPageItems(items), {
    status: 'published',
    includeFuture: false
  });
  return sortBlogCards(visible)
    .map((card) => {
      const slug = card.slug || card.listItemID;
      return slug ? { ...card, slug, url: `${siteOrigin()}/blog/${slug}` } : null;
    })
    .filter(Boolean);
}

function sendCacheable(res, contentType, body) {
  res.set('Content-Type', contentType);
  // Crawler-facing and cheap to regenerate; a short shared cache keeps a crawl
  // burst off DynamoDB without letting a new post sit unlisted for long.
  res.set('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600');
  return res.send(body);
}

/**
 * GET /api/discovery/sitemap.xml
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    const origin = siteOrigin();
    const posts = await loadPublishedPosts();

    const staticUrls = STATIC_ROUTES.map((route) => [
      '  <url>',
      `    <loc>${escapeXml(origin + route.path)}</loc>`,
      `    <changefreq>${route.changefreq}</changefreq>`,
      `    <priority>${route.priority}</priority>`,
      '  </url>'
    ].join('\n'));

    const postUrls = posts.map((post) => {
      const lastmod = toIsoDate(post.publishDate);
      return [
        '  <url>',
        `    <loc>${escapeXml(post.url)}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        '    <changefreq>yearly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>'
      ].filter(Boolean).join('\n');
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...staticUrls,
      ...postUrls,
      '</urlset>',
      ''
    ].join('\n');

    return sendCacheable(res, 'application/xml; charset=utf-8', xml);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/discovery/rss.xml
 */
router.get('/rss.xml', async (req, res) => {
  try {
    const origin = siteOrigin();
    const posts = (await loadPublishedPosts()).slice(0, MAX_FEED_ITEMS);
    const latest = toRfc822(posts[0]?.publishDate) || new Date().toUTCString();

    const items = posts.map((post) => {
      const pubDate = toRfc822(post.publishDate);
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(post.url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(post.url)}</guid>`,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : null,
        post.category ? `      <category>${escapeXml(post.category)}</category>` : null,
        `      <description>${escapeXml(post.summary)}</description>`,
        '    </item>'
      ].filter(Boolean).join('\n');
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '  <channel>',
      '    <title>Grayson Wills</title>',
      `    <link>${escapeXml(origin + '/blog')}</link>`,
      '    <description>Essays, reflections, and the occasional technical note.</description>',
      '    <language>en-us</language>',
      `    <lastBuildDate>${latest}</lastBuildDate>`,
      `    <atom:link href="${escapeXml(origin + '/rss.xml')}" rel="self" type="application/rss+xml"/>`,
      ...items,
      '  </channel>',
      '</rss>',
      ''
    ].join('\n');

    return sendCacheable(res, 'application/rss+xml; charset=utf-8', xml);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/discovery/feed.json
 */
router.get('/feed.json', async (req, res) => {
  try {
    const origin = siteOrigin();
    const posts = (await loadPublishedPosts()).slice(0, MAX_FEED_ITEMS);

    return sendCacheable(res, 'application/feed+json; charset=utf-8', JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Grayson Wills',
      home_page_url: `${origin}/blog`,
      feed_url: `${origin}/feed.json`,
      description: 'Essays, reflections, and the occasional technical note.',
      language: 'en-US',
      items: posts.map((post) => ({
        id: post.url,
        url: post.url,
        title: post.title,
        summary: post.summary,
        date_published: toIsoDate(post.publishDate),
        tags: Array.isArray(post.tags) ? post.tags : []
      }))
    }, null, 2));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/discovery/llms.txt
 * Plain-text site index for model crawlers (llmstxt.org).
 */
router.get('/llms.txt', async (req, res) => {
  try {
    const origin = siteOrigin();
    const posts = await loadPublishedPosts();

    const lines = [
      '# Grayson Wills',
      '',
      '> Personal site: work history, projects, and a blog of essays, reflections,',
      '> and the occasional technical note.',
      '',
      '## Pages',
      ...STATIC_ROUTES.map((route) => `- [${route.path === '/' ? 'Home' : route.path.slice(1)}](${origin}${route.path})`),
      '',
      '## Blog posts',
      ...posts.map((post) => {
        const date = toIsoDate(post.publishDate);
        const when = date ? ` (${date.slice(0, 10)})` : '';
        const summary = post.summary ? `: ${post.summary}` : '';
        return `- [${post.title}](${post.url})${when}${summary}`;
      }),
      ''
    ];

    return sendCacheable(res, 'text/plain; charset=utf-8', lines.join('\n'));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/discovery/robots.txt
 */
router.get('/robots.txt', async (req, res) => {
  const origin = siteOrigin();
  const body = [
    'User-agent: *',
    'Allow: /',
    'Allow: /api/content/',
    'Allow: /api/discovery/',
    'Disallow: /account',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    ''
  ].join('\n');

  return sendCacheable(res, 'text/plain; charset=utf-8', body);
});

module.exports = router;
