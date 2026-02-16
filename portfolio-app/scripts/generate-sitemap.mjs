import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const OUT_FILE = path.join(PUBLIC_DIR, 'sitemap.xml');

const BASE_URL = (process.env.PORTFOLIO_BASE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, '');
const CONTENT_ENDPOINT = process.env.PORTFOLIO_SEO_CONTENT_ENDPOINT || 'https://api.grayson-wills.com/api/content';

const STATIC_PATHS = ['/', '/work', '/projects', '/blog'];

function toIsoDate(dateLike) {
  const d = new Date(dateLike);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function fetchBlogRoutes() {
  const routes = [];

  try {
    const res = await fetch(CONTENT_ENDPOINT, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    if (!Array.isArray(items)) throw new Error('Unexpected response shape');

    const lastmodById = new Map();
    for (const item of items) {
      const id = item?.ListItemID;
      if (typeof id !== 'string' || !id.startsWith('blog-post-')) continue;

      const updated = toIsoDate(item?.UpdatedAt) || toIsoDate(item?.CreatedAt);
      if (!updated) continue;

      const prev = lastmodById.get(id);
      if (!prev || updated > prev) lastmodById.set(id, updated);
    }

    for (const [id, lastmod] of [...lastmodById.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      routes.push({ path: `/blog/${id}`, lastmod });
    }
  } catch (err) {
    // Network failures shouldn't break a build; we still emit a static-only sitemap.
    console.warn(`[sitemap] Failed to fetch blog routes from ${CONTENT_ENDPOINT}: ${err?.message || err}`);
  }

  return routes;
}

function buildXml(urls) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  for (const url of urls) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(url.loc)}</loc>`);
    if (url.lastmod) lines.push(`    <lastmod>${escapeXml(url.lastmod)}</lastmod>`);
    if (url.changefreq) lines.push(`    <changefreq>${escapeXml(url.changefreq)}</changefreq>`);
    if (typeof url.priority === 'number') lines.push(`    <priority>${url.priority.toFixed(1)}</priority>`);
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  lines.push('');
  return lines.join('\n');
}

const staticUrls = STATIC_PATHS.map((p) => ({
  loc: `${BASE_URL}${p}`,
  changefreq: 'weekly',
  priority: p === '/' ? 1.0 : 0.8
}));

const blogRoutes = await fetchBlogRoutes();
const blogUrls = blogRoutes.map((r) => ({
  loc: `${BASE_URL}${r.path}`,
  lastmod: r.lastmod,
  changefreq: 'monthly',
  priority: 0.7
}));

await fs.mkdir(PUBLIC_DIR, { recursive: true });
await fs.writeFile(OUT_FILE, buildXml([...staticUrls, ...blogUrls]), 'utf8');
console.log(`[sitemap] Wrote ${path.relative(process.cwd(), OUT_FILE)} with ${staticUrls.length + blogUrls.length} URL(s).`);

