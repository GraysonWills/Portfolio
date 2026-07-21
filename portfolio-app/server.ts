import 'zone.js/node';
import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express, { NextFunction, Request, Response } from 'express';
import serverless from 'serverless-http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import bootstrap from './src/main.server';
import { SSR_API_ORIGIN, SSR_EDGE_SECRET } from './src/app/services/ssr-api-origin.interceptor';

const CANONICAL_ORIGIN = 'https://www.grayson-wills.com';
const DISCOVERY_PATHS = new Map([
  ['/sitemap.xml', '/api/discovery/sitemap.xml'],
  ['/rss.xml', '/api/discovery/rss.xml'],
  ['/feed.json', '/api/discovery/feed.json'],
  ['/llms.txt', '/api/discovery/llms.txt'],
  ['/robots.txt', '/api/discovery/robots.txt']
]);
const DEFAULT_ALLOWED_HOSTS = [
  'www.grayson-wills.com',
  'grayson-wills.com',
  'localhost',
  '127.0.0.1',
  '*.lambda-url.us-east-1.on.aws',
  '*.lambda-url.us-east-2.on.aws'
];

type BlogResolution = {
  listItemID?: string;
  slug?: string;
  canonicalPath?: string;
  redirect?: boolean;
};

function requestOrigin(req: Request): string {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'www.grayson-wills.com').split(',')[0].trim();
  return `${protocol}://${host}`;
}

function effectivePath(req: Request): string {
  const forwarded = String(req.headers['x-portfolio-original-uri'] || '').trim();
  if (forwarded.startsWith('/')) return forwarded.split('?')[0] || '/';
  return req.path;
}

function effectiveOriginalUrl(req: Request): string {
  const forwarded = String(req.headers['x-portfolio-original-uri'] || '').trim();
  if (!forwarded.startsWith('/')) return req.originalUrl;
  const queryIndex = req.originalUrl.indexOf('?');
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
  return `${forwarded.split('?')[0]}${query}`;
}

async function resolveBlogRoute(req: Request): Promise<{ status: number; resolution?: BlogResolution }> {
  const hasPreviewToken = typeof req.query['previewToken'] === 'string' && !!String(req.query['previewToken']).trim();
  if (hasPreviewToken) return { status: 200 };
  const path = effectivePath(req);
  const match = /^\/blog\/([^/?#]+)\/?$/.exec(path);
  if (!match) {
    const normalizedPath = path.replace(/\/+$/, '') || '/';
    const knownRoute = normalizedPath === '/'
      || normalizedPath === '/work'
      || normalizedPath === '/projects'
      || normalizedPath === '/blog'
      || normalizedPath === '/account'
      || normalizedPath.startsWith('/account/')
      || normalizedPath === '/notifications'
      || normalizedPath.startsWith('/notifications/');
    return { status: knownRoute ? 200 : 404 };
  }

  const value = decodeURIComponent(match[1]);
  const base = String(process.env['SSR_PUBLIC_API_ORIGIN'] || requestOrigin(req)).replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const edgeSecret = String(process.env['PUBLIC_EDGE_SHARED_SECRET'] || '').trim();
  if (edgeSecret) headers['x-portfolio-edge-secret'] = edgeSecret;

  try {
    const response = await fetch(`${base}/api/content/v3/blog/resolve/${encodeURIComponent(value)}`, { headers });
    if (response.status === 404) return { status: 404 };
    if (!response.ok) return { status: response.status >= 500 ? 200 : response.status };
    return { status: 200, resolution: await response.json() as BlogResolution };
  } catch {
    // Renderer failures must not turn a healthy S3 fallback into a false 404.
    return { status: 200 };
  }
}

function cacheHeaders(req: Request, res: Response): void {
  const hasPreviewToken = typeof req.query['previewToken'] === 'string' && !!String(req.query['previewToken']).trim();
  if (hasPreviewToken) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
}

export function app(): express.Express {
  const server = express();
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(serverDistFolder, 'index.server.html');
  const configuredAllowedHosts = String(process.env['SSR_ALLOWED_HOSTS'] || '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean);
  const commonEngine = new CommonEngine({
    allowedHosts: [...DEFAULT_ALLOWED_HOSTS, ...configuredAllowedHosts]
  });

  server.set('trust proxy', true);
  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

  server.use((req: Request, res: Response, next: NextFunction) => {
    const expected = String(process.env['SSR_ORIGIN_SHARED_SECRET'] || '').trim();
    if (!expected || req.headers['x-portfolio-ssr-secret'] === expected) return next();
    return res.status(403).send('Forbidden');
  });

  server.get('/:key.txt', (req: Request, res: Response, next: NextFunction) => {
    const key = String(process.env['INDEXNOW_KEY'] || '').trim();
    if (!key || req.params['key'] !== key) return next();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400');
    return res.send(key);
  });

  server.get(Array.from(DISCOVERY_PATHS.keys()), async (req: Request, res: Response, next: NextFunction) => {
    const targetPath = DISCOVERY_PATHS.get(req.path);
    if (!targetPath) return next();
    const base = String(process.env['SSR_PUBLIC_API_ORIGIN'] || requestOrigin(req)).replace(/\/+$/, '');
    const headers: Record<string, string> = { Accept: '*/*' };
    const edgeSecret = String(process.env['PUBLIC_EDGE_SHARED_SECRET'] || '').trim();
    if (edgeSecret) headers['x-portfolio-edge-secret'] = edgeSecret;
    try {
      const response = await fetch(`${base}${targetPath}`, { headers });
      const body = await response.text();
      const contentType = response.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', response.headers.get('cache-control') || 'public, max-age=60, s-maxage=300');
      return res.status(response.status).send(body);
    } catch (error) {
      return next(error);
    }
  });

  const staticAssets = express.static(browserDistFolder, { maxAge: '1y', immutable: true });
  server.get('*.*', (req: Request, res: Response, next: NextFunction) => {
    if (req.headers['x-portfolio-original-uri']) return next();
    return staticAssets(req, res, next);
  });

  server.get('*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      cacheHeaders(req, res);
      const route = await resolveBlogRoute(req);
      if (route.status === 404) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      }
      const canonicalPath = String(route.resolution?.canonicalPath || '').trim();
      if (route.resolution?.redirect && canonicalPath && canonicalPath !== effectivePath(req)) {
        return res.redirect(301, `${CANONICAL_ORIGIN}${canonicalPath}`);
      }

      const html = await commonEngine.render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${requestOrigin(req)}${effectiveOriginalUrl(req)}`,
        publicPath: browserDistFolder,
        providers: [
          { provide: APP_BASE_HREF, useValue: req.baseUrl || '/' },
          { provide: SSR_API_ORIGIN, useValue: String(process.env['SSR_PUBLIC_API_ORIGIN'] || requestOrigin(req)).replace(/\/+$/, '') },
          { provide: SSR_EDGE_SECRET, useValue: String(process.env['PUBLIC_EDGE_SHARED_SECRET'] || '').trim() }
        ]
      });
      return res.status(route.status).send(html);
    } catch (error) {
      return next(error);
    }
  });

  return server;
}

function run(): void {
  const port = Number(process.env['PORT'] || 4000);
  app().listen(port, () => {
    console.log(`Portfolio SSR renderer listening on http://localhost:${port}`);
  });
}

if (isMainModule(import.meta.url)) {
  run();
}

export const handler = serverless(app());
