# Portfolio Site - Full Stack Project

A comprehensive portfolio website project consisting of an Angular frontend, Node.js/Express backend API, and a blog authoring GUI. The frontend is deployed to AWS S3 + CloudFront via GitHub Actions. The Redis API server is currently intended to run locally (production hosting TBD).

## Project Structure

This repository contains three main projects:

### 1. Portfolio App (`portfolio-app/`)
The main Angular portfolio website featuring:
- Multi-page architecture (Landing, Work, Projects, Blog)
- **Full blog detail pages** — click any blog card to read the complete article
- Rich blog content: Markdown paragraphs, inline images, image carousels, headings, block quotes
- Recent posts section at the bottom of each blog article
- PrimeNG UI components
- Dynamic content loading from Redis
- LinkedIn integration
- Mailchimp newsletter subscription
- Responsive design

**Tech Stack:**
- Angular 19.x
- PrimeNG 19.x
- TypeScript
- SCSS
- `marked` (Markdown rendering)

### 2. Redis API Server (`redis-api-server/`)
Node.js/Express backend API for Redis Cloud integration:
- RESTful API endpoints for content management
- Redis Cloud database connection
- Image upload handling
- Admin operations via Redis Cloud REST API
- Health check endpoints

**Tech Stack:**
- Node.js (LTS 18.x+)
- Express.js
- Redis (via `redis` package)
- RedisJSON support

### 3. Blog Author (`blog-author/`)
Lightweight Node.js/Express + vanilla HTML/CSS/JS application for creating and managing blog posts:
- **Card Info Editor** — title, category, status, tags, cover image, summary
- **Article Body Editor** — block-based content editor with:
  - Paragraphs (with Markdown formatting toolbar: bold, italic, code, links, lists)
  - Headings (H2, H3, H4)
  - Inline images with alt text and captions
  - Image carousels with multiple slides
  - Block quotes with optional author attribution
- **Live Preview** — card preview + full article preview matching portfolio rendering
- Direct publishing to Redis via the API server
- Reorder, add, and delete content blocks
- Runs locally at `http://localhost:4201` (not deployed)

**Tech Stack:**
- Node.js + Express.js
- Vanilla HTML/CSS/JS
- `marked` (Markdown rendering in preview)
- PrimeIcons

## Prerequisites

- **Node.js** (LTS version 18.x or higher)
- **npm** (10.x or higher)
- **Angular CLI** (19.x or higher) - for Angular projects
- **Redis Cloud** account and database
- **Git** for version control

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd Portfolio
```

### 2. Set Up Environment Variables

**Redis API Server** (`redis-api-server/.env`):
```env
REDIS_HOST=redis-15545.c14.us-east-1-2.ec2.cloud.redislabs.com
REDIS_PORT=15545
REDIS_PASSWORD=your-redis-cloud-password
REDIS_TLS=true
REDIS_DB=0
PORT=3000
ALLOWED_ORIGINS=http://localhost:4200,http://localhost:4201,http://localhost:4300,http://localhost:4301,http://localhost:3000
CACHE_TTL_MS=60000
CACHE_MAX_ENTRIES=500
```

**Blog Author** (`blog-author/.env`):
```env
PORT=4201
REDIS_API_URL=http://localhost:3000
```

### 3. Install Dependencies

```bash
# Redis API Server
cd redis-api-server && npm install && cd ..

# Portfolio App
cd portfolio-app && npm install && cd ..

# Blog Author
cd blog-author && npm install && cd ..
```

### 4. Seed the Database (first time only)

```bash
cd redis-api-server
node src/seed.js
```

### 5. Start Development Servers

**Redis API Server** (must be running first):
```bash
cd redis-api-server && npm start
# → http://localhost:3000
```

**Portfolio App**:
```bash
cd portfolio-app && npm start
# → http://localhost:4200
```

To run on the currently used local port:
```bash
cd portfolio-app && npm start -- --port 4300
# → http://localhost:4300
```

**Blog Authoring GUI** (Angular editor):
```bash
cd blog-authoring-gui && npm install && npm start -- --port 4301
# → http://localhost:4301
```

**Blog Author** (optional, local only):
```bash
cd blog-author && npm start
# → http://localhost:4201
```

## AWS Deployment (Frontend)

The portfolio frontend (`portfolio-app/`) is hosted as a static site:

- **S3 bucket:** `www.grayson-wills.com` (region: `us-east-2`)
- **CloudFront distribution:** `E28CZKZOGGZGVK` (alias: `www.grayson-wills.com`)
- **Route53:** `www.grayson-wills.com` CNAME -> CloudFront

### CI/CD (GitHub Actions)

Workflow: `.github/workflows/ci-cd.yml`

On push to `main` or `master`, the workflow:

1. Builds the Angular production bundle
2. Syncs `portfolio-app/dist/portfolio-app/browser` to `s3://www.grayson-wills.com/`
3. Uploads `index.html` with `no-cache` headers (to avoid stale SPA shells)
4. Invalidates CloudFront (`/*`)

### AWS Auth (No Long-Lived Keys)

Deployment uses **GitHub OIDC** (no `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` repo secrets):

- IAM OIDC Provider: `token.actions.githubusercontent.com`
- IAM Role: `arn:aws:iam::381492289909:role/GitHubActionsPortfolioDeploy`

If you ever need to recreate the role/provider, use the AWS CLI from a session with admin permissions and lock the role trust policy to your repo + branches.

### Production Redis API Note

The deployed frontend expects a live Redis API endpoint (see `portfolio-app/src/environments/environment.prod.ts`). Before shipping a build to `www.grayson-wills.com`, make sure the production `redisApiUrl` points to a real API host and that CORS/origin settings allow `https://www.grayson-wills.com`.

## AWS Deployment (Redis API)

The Redis API server (`redis-api-server/`) is deployed as:

- **AWS Lambda:** `portfolio-redis-api` (region: `us-east-2`)
- **API Gateway (HTTP API):** `https://api.grayson-wills.com`
- **Base path:** `/api` (example: `https://api.grayson-wills.com/api/health`)

Write endpoints (POST/PUT/DELETE + uploads) are protected by Cognito JWT auth; read endpoints remain public for the portfolio.

Workflow: `.github/workflows/api-deploy.yml`

## AWS Deployment (Blog Authoring Dev)

The blog authoring GUI (`blog-authoring-gui/`) is deployed as a static site:

- **S3 bucket:** `grayson-wills-blog-authoring-dev-381492289909` (region: `us-east-2`)
- **CloudFront distribution:** `E31OPQLJ4WFI66`
- **CloudFront URL:** `https://d39s45clv1oor3.cloudfront.net`

Authentication is backed by **Amazon Cognito User Pool** `us-east-2_dzSpoyFyI` (password resets email a verification code to the user’s verified email).

## Images (S3)

Uploaded images are stored in:

- **S3 bucket:** `grayson-wills-media-381492289909` (public read for `uploads/*`)
- Upload endpoint: `POST https://api.grayson-wills.com/api/upload/image` (requires auth)

## Redis Data Schema

The application uses Redis with the following schema:

| Field | Type | Description |
|-------|------|-------------|
| ID | string | Redis-generated row identifier |
| Text | string | Main textual content (optional) |
| Photo | string | Associated image URL/Base64 (optional) |
| ListItemID | string | Grouping for text/photo as list element |
| PageID | number | Page section (0: Landing, 1: Work, 2: Projects, 3: Blog) |
| PageContentID | number | Semantic role within page |
| Metadata | object | Additional metadata (tags, status, etc.) |
| CreatedAt | string | ISO timestamp |
| UpdatedAt | string | ISO timestamp |

### PageContentID Values

| ID | Name | Description |
|----|------|-------------|
| 0 | HeaderText | Site header text |
| 1 | HeaderIcon | Site header icon/avatar |
| 2 | FooterIcon | Footer social icons |
| 3 | BlogItem | Blog post metadata (title, summary, tags, etc.) |
| 4 | BlogText | Blog post plain text (legacy/fallback) |
| 5 | BlogImage | Blog post cover image |
| 6 | LandingPhoto | Landing page carousel photos |
| 7 | LandingText | Landing page text content |
| 8 | WorkText | Work experience entries |
| 9 | ProjectsCategoryPhoto | Project category cover photos |
| 10 | ProjectsCategoryText | Project category names |
| 11 | ProjectsPhoto | Individual project photos |
| 12 | ProjectsText | Individual project details |
| **13** | **BlogBody** | **Blog post rich body content (JSON array of blocks)** |
| **14** | **WorkSkillMetric** | **Career/skill metric bars shown in Work page progress cards** |

### Redis ID Conventions

- Redis key format: `content:{ID}`
- `ID` should be stable and unique (examples: `work-exp-001`, `work-metric-architecture`, `blog-text-1739472`)
- `ListItemID` groups related rows that belong to one logical item:
  - Example: all rows for one blog post share a single `ListItemID`
  - Example: each career metric uses `career-metric-{n}` as `ListItemID`
- `Metadata.order` is used for deterministic display order in timelines/metric lists.

### Work Skill Metric Record Format

`PageID = 1`, `PageContentID = 14`

```json
{
  "ID": "work-metric-architecture",
  "Text": "{\"label\":\"AI Systems Architecture\",\"value\":86,\"level\":\"Advanced\",\"summary\":\"Production design and platform integration across analytics + AI workflows\"}",
  "ListItemID": "career-metric-1",
  "PageID": 1,
  "PageContentID": 14,
  "Metadata": { "type": "career-metric", "order": 1 }
}
```

### Blog Post Structure

Each blog post consists of 4 Redis records sharing the same `ListItemID`:

1. **BlogItem** (PageContentID: 3) — Title text + `Metadata` with title, summary, tags, publishDate, status, category
2. **BlogText** (PageContentID: 4) — Plain text fallback content
3. **BlogImage** (PageContentID: 5) — Cover image URL + alt text in Metadata
4. **BlogBody** (PageContentID: 13) — JSON array of content blocks stored in `Text` field

### Blog Body Block Types

The `BlogBody` `Text` field contains a JSON array of blocks:

```json
[
  { "type": "paragraph", "content": "Markdown text with **bold**, *italic*, `code`..." },
  { "type": "heading", "content": "Section Title", "level": 2 },
  { "type": "image", "url": "https://...", "alt": "Description", "caption": "Optional" },
  { "type": "carousel", "images": [{ "url": "...", "alt": "..." }], "caption": "Optional" },
  { "type": "quote", "content": "Quote text...", "author": "Optional Author" }
]
```

## Blog System Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Blog Author     │     │  Redis API       │     │  Portfolio App   │
│  (localhost:4201) │────▶│  (localhost:3000) │◀────│  (localhost:4200)│
│  Create/Edit     │     │  CRUD + Storage   │     │  Display/Read    │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                        │                        │
        │  POST/PUT/DELETE       │  JSON over Redis       │  GET content
        │  /api/posts            │  RedisJSON             │  /api/content
        └────────────────────────┘────────────────────────┘
```

**Authoring Flow:**
1. Write post in Blog Author (card info + article body blocks)
2. Click "Publish to Redis" → saves 4 records via API
3. Portfolio app fetches and renders the post
4. Clicking a blog card navigates to `/blog/:listItemId` for full article view

## CI/CD

### GitHub Actions

GitHub Actions workflows are configured for automated CI/CD:
- Automated testing
- Production builds
- Deployment to EC2

**Required GitHub Secrets:**
- `REDIS_API_URL`
- `MAILCHIMP_API_KEY`
- `MAILCHIMP_LIST_ID`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `EC2_HOST`
- `EC2_USER`
- `EC2_SSH_KEY`

## Security Notes

> **Important:** This repository uses `.gitignore` to exclude sensitive files:
> - `.env` files
> - Credentials and keys
> - Configuration files with secrets
> - Build artifacts

Never commit sensitive information to the repository. Use environment variables and GitHub Secrets for production deployments.

## Development Workflow

1. **Start Redis API Server** — Must be running before portfolio app
2. **Start Portfolio App** — Main frontend application
3. **Use Blog Author** — For creating/managing blog posts (local only)
4. **Test Locally** — All services should be accessible on localhost
5. **Commit Changes** — Use conventional commit messages
6. **Push to GitHub** — CI/CD will handle deployment

## Troubleshooting

### Redis Connection Issues
- Verify Redis Cloud endpoint and password
- Check that TLS is enabled (`REDIS_TLS=true`)
- Ensure Redis API server is running
- Check network connectivity

### Build Errors
- Clear `node_modules` and reinstall: `rm -rf node_modules package-lock.json && npm install`
- Clear Angular cache: `ng cache clean`
- Check Node.js version compatibility

### Port Conflicts
- Redis API Server: Change `PORT` in `redis-api-server/.env`
- Portfolio App: Use `ng serve --port <port>`
- Blog Author: Change `PORT` in `blog-author/.env`

## Support

For issues and questions:
- Email: calvarygman@gmail.com
- LinkedIn: www.linkedin.com/in/grayson-wills
- Website: www.grayson-wills.com

## License

Copyright © 2025 Grayson Wills. All rights reserved.
