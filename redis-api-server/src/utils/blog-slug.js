/**
 * Blog slug derivation.
 *
 * Shared by the write path (services/blog-posts.js persists the slug into post
 * metadata and stamps it into the social plannedUrl) and the public read path
 * (routes/content.js resolves /blog/<slug> back to a post). These two must
 * derive slugs identically -- if they ever drift, already-published permalinks
 * stop resolving and every shared link 404s.
 */
function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

module.exports = { normalizeSlug };
