# 02. Routing + Runtime Contracts

## Frontend Route Boundaries

Source: `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/app-routing.module.ts`

- `/` -> Landing page
- `/work` -> Work module
- `/projects` -> Projects module
- `/blog` -> Blog module + detail routes
- `/notifications/*` -> subscription confirm/unsubscribe flows

Pattern to reuse:
- Keep public routes mostly read-only.
- Keep operational routes (`/notifications`, preview hooks) explicit.
- Use lazy-loaded modules for major sections.

## Authoring Route Boundaries

Source: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/app-routing.module.ts`

- `/login`
- `/register`
- `/forgot-password`
- `/dashboard` (auth guard)
- `/content` (auth guard)
- `/subscribers` (auth guard)
- `/collections` (auth guard)

Pattern to reuse:
- Segregate auth routes from content management routes.
- Guard all write-capable pages.

## API Route Boundaries

Sources:
- `/Users/grayson/Desktop/Portfolio/redis-api-server/src/app.js`
- `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/*.js`

Mounted under `/api`:
- `/health/*` -> liveness/readiness/system checks
- `/content/*` -> content CRUD, preview session tokens
- `/upload/*` -> media upload
- `/admin/*` -> infra/admin utilities (optional)
- `/subscriptions/*` -> email subscribe/confirm/unsubscribe/preferences
- `/notifications/*` -> send now / schedule / worker callback

## Middleware Contract

- Global middleware order in API app:
  1. `helmet`
  2. CORS allowlist
  3. compression
  4. request logging (`morgan`)
  5. global API rate-limit
  6. body-size limits
  7. response cache for GETs
  8. route mounts
  9. 404 + error handler

- Write protection:
  - `requireAuth` for write endpoints on content/upload/notifications.
  - Public read endpoints stay unauthenticated for portfolio consumption.

## Runtime Profiles

- Local dev:
  - Portfolio app: `localhost:4200` (or `4300`)
  - Authoring app: `localhost:4301` (default local override)
  - API: `localhost:3000`
- Production:
  - Portfolio app: CloudFront + S3
  - Authoring app: CloudFront + S3
  - API: API Gateway + Lambda/ECS backend
