# Redis API Server

Backend API server for portfolio/blog content management. Supports DynamoDB-first operation with optional Redis compatibility mode.

## Features

- RESTful API endpoints for content CRUD operations
- Content storage backend: **DynamoDB (recommended)** or **Redis compatibility mode**
- Image upload (S3-backed)
- Health check endpoint
- Redis JSON storage support (with fallback to string storage)
- CORS enabled for Angular frontend
- Environment variable configuration
- Auto-detects TLS for RedisLabs connections
- **Optional**: Redis Cloud API integration for management operations
- **Write auth:** POST/PUT/DELETE + uploads can be protected with Cognito JWTs (read endpoints stay public)
- **Optional**: Queue-backed blog notification delivery via SQS + Lambda consumer

## Prerequisites

- Node.js (LTS version 18.x or higher)
- npm or yarn
- **DynamoDB** table access for content and preview sessions
- **Optional** Redis access only if you run legacy compatibility mode
- **Optional**: Redis Cloud API keys (Account Key + User Key) for admin operations

## Quick Setup

### Option 1: Automated Setup (Windows PowerShell)

```powershell
cd redis-api-server
.\setup.ps1
npm install
npm start
```

The setup script will prompt you for:
- **Redis Cloud Database Connection:**
  - Redis Cloud endpoint (e.g., `redis-15545.c14.us-east-1-2.ec2.cloud.redislabs.com:15545`)
  - Redis Cloud database password (for data operations)
  - TLS is automatically enabled for Redis Cloud (port 15545)
  
- **Redis Cloud API Keys (Optional):**
  - Account Key (x-api-key)
  - User Key (x-api-secret-key)

- **Server Configuration:**
  - API server port (default: 3000)

**Important:** The database password and API keys serve different purposes:
- **Database Password**: Required for data operations (read/write blog posts, content)
- **API Keys**: Optional, used only for management/admin operations (view database info, status, logs)

### Option 2: Manual Setup

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` with your runtime configuration:**
   ```env
   # Recommended: DynamoDB content backend
   CONTENT_BACKEND=dynamodb
   CONTENT_TABLE_NAME=portfolio-content
   PREVIEW_SESSIONS_TABLE_NAME=portfolio-content-preview-sessions
   DDB_REGION=us-east-2

   # Optional: Redis compatibility mode (only if needed)
   # REDIS_HOST=redis-host
   # REDIS_PORT=6379
   # REDIS_PASSWORD=...
   # REDIS_TLS=true
   
   # Server Configuration
   PORT=3000
   NODE_ENV=development
   ```

4. **Start Server:**
   ```bash
   # Development (with auto-reload)
   npm run dev
   
   # Production
   npm start
   ```

## Configuration

### Optional: Redis Compatibility Connection

These are used for **data operations** (storing/retrieving content):

| Variable | Description | Required |
|----------|-------------|----------|
| `REDIS_HOST` | Redis host | ❌ Optional |
| `REDIS_PORT` | Redis port | ❌ Optional |
| `REDIS_PASSWORD` | Redis password | ❌ Optional |
| `REDIS_TLS` | Enable TLS connection | ❌ Optional |
| `REDIS_DB` | Redis database number | No (default: 0) |

**Note:** 
- If `REDIS_HOST` is unset, Redis is disabled.
- DynamoDB mode does not require Redis.

### Optional: Redis Cloud REST API Keys

These are used for **management/admin operations** only (not for data):

| Variable | Description | Required |
|----------|-------------|----------|
| `REDIS_CLOUD_ACCOUNT_KEY` | Redis Cloud Account API Key | ❌ Optional |
| `REDIS_CLOUD_USER_KEY` | Redis Cloud User API Key | ❌ Optional |

**When to use API keys:**
- Viewing database information and status
- Monitoring usage and metrics
- Managing databases programmatically
- Getting connection details via API

**When NOT to use API keys:**
- Reading/writing blog posts
- Storing/retrieving portfolio content
- Data operations (these use the database password)

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins for CORS | `http://localhost:4200,http://localhost:3000` |
| `CACHE_TTL_MS` | In-memory GET cache TTL (milliseconds) | `60000` |
| `PREVIEW_TTL_SECONDS` | Preview session TTL in seconds | `21600` |
| `PREVIEW_SESSIONS_TABLE_NAME` | DynamoDB table for preview payloads | `portfolio-content-preview-sessions` |
| `PREVIEW_MAX_BYTES` | Max preview payload size in bytes | `1048576` |
| `PREVIEW_MAX_UPSERTS` | Max upsert records per preview session | `500` |
| `PREVIEW_MAX_DELETES` | Max delete IDs/listItemIDs per preview session | `500` |

### Optional: DynamoDB Content Store (Recommended)

ElastiCache Global Datastore requires **large** instance classes and is usually
overkill/too expensive for a portfolio site. To get multi-region durability
without changing your frontend/API payloads, you can store content in DynamoDB
(and optionally use DynamoDB Global Tables for cross-region replication).

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTENT_BACKEND` | `redis` or `dynamodb` | `redis` |
| `CONTENT_TABLE_NAME` | DynamoDB table name for content (required if `CONTENT_BACKEND=dynamodb`) | *(none)* |

### Optional: Cognito Auth (Recommended)

If set, all **write** endpoints require `Authorization: Bearer <Cognito ID token>`.

| Variable | Description | Required |
|----------|-------------|----------|
| `COGNITO_REGION` | Cognito region | ✅ Yes |
| `COGNITO_USER_POOL_ID` | User pool ID | ✅ Yes |
| `COGNITO_CLIENT_ID` | App client ID | ✅ Yes |
| `DISABLE_AUTH` | Set to `true` to disable auth checks (local only) | ❌ Optional |

### Optional: S3 Uploads (Recommended)

If set, `POST /api/upload/image` stores images in S3 and returns a public URL.

| Variable | Description | Required |
|----------|-------------|----------|
| `S3_UPLOAD_BUCKET` | S3 bucket to store images | ✅ Yes |
| `S3_UPLOAD_REGION` | S3 bucket region | ✅ Yes |
| `S3_UPLOAD_PREFIX` | Key prefix (default: `uploads/`) | ❌ Optional |

### Optional: Notification Queue (Recommended for production)

If configured, blog publish notifications are enqueued to SQS and sent asynchronously by Lambda.
If not configured, the API falls back to direct SES sends.
Signup confirmation emails are currently direct-send; queueing those is a planned follow-up.

| Variable | Description | Required |
|----------|-------------|----------|
| `NOTIFICATION_QUEUE_ENABLED` | Enable queue-backed sends (`true`/`false`) | ❌ Optional (default `true` when queue URL exists) |
| `NOTIFICATION_QUEUE_URL` | SQS queue URL used for blog notification jobs | ✅ Yes (to enable queue mode) |

## API Endpoints

### Health Check

- **GET** `/api/health` - Check server/database status (Redis + DynamoDB sections)

### Content Operations

- **GET** `/api/content` - Get all content
- **GET** `/api/content/:id` - Get content by ID
- **GET** `/api/content/page/:pageId` - Get content by PageID
- **GET** `/api/content/list-item/:listItemId` - Get content by ListItemID
- **GET** `/api/content/preview/:token` - Get tokenized draft preview payload
- **POST** `/api/content` - Create new content item (auth required)
- **POST** `/api/content/batch` - Create multiple content items (auth required)
- **POST** `/api/content/preview/session` - Create short-lived preview session (auth required)
- **PUT** `/api/content/:id` - Update content by ID (auth required)
- **DELETE** `/api/content/:id` - Delete content by ID (auth required)
- **DELETE** `/api/content/list-item/:listItemId` - Delete all content by ListItemID (auth required)

### Admin (Optional - requires API keys)

- **GET** `/api/admin/databases` - List all databases
- **GET** `/api/admin/databases/:id` - Get database information
- **GET** `/api/admin/databases/:id/status` - Get database status summary

### Upload

- **POST** `/api/upload/image` - Upload image (auth required)
  - Content-Type: `multipart/form-data`
  - Form field: `image` (file)
  - Returns `{ url }` (S3 URL)

## Redis Data Structure

Content is stored in Redis with the following structure:

```json
{
  "ID": "unique-id",
  "Text": "content text",
  "Photo": "image-url-or-base64",
  "ListItemID": "group-id",
  "PageID": 0,
  "PageContentID": 0,
  "Metadata": {},
  "CreatedAt": "2024-01-01T00:00:00.000Z",
  "UpdatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Storage Format:**
- Redis JSON module: `content:{ID}` (if RedisJSON is available)
- Fallback: String storage with JSON serialization
- DynamoDB: store the same JSON document as an item (PK: `ID`)

**PageID Values:**
- `0` - Landing
- `1` - Work
- `2` - Projects
- `3` - Blog

**PageContentID Values:**
- `0` - HeaderText
- `1` - HeaderIcon
- `2` - FooterIcon
- `3` - BlogItem
- `4` - BlogText
- `5` - BlogImage
- `6` - LandingPhoto
- `7` - LandingText
- `8` - WorkText
- `9` - ProjectsCategoryPhoto
- `10` - ProjectsCategoryText
- `11` - ProjectsPhoto
- `12` - ProjectsText
- `13` - BlogBody
- `14` - WorkSkillMetric

### ID and Grouping Conventions

- Redis key pattern: `content:{ID}`
- `ID` is the immutable row identifier used by `PUT /api/content/:id` and `DELETE /api/content/:id`.
- `ListItemID` groups multiple records into one logical entity:
  - Blog post rows (metadata/text/image/body) share one `ListItemID`.
  - Work timeline entries use `experience-{n}`.
  - Career metric bars use `career-metric-{n}`.
- Use `Metadata.order` when a grouped collection must render in a fixed order.

### Work Skill Metric Payload

For `PageID = 1` and `PageContentID = 14`, store JSON in `Text`:

```json
{
  "label": "AI Systems Architecture",
  "value": 86,
  "level": "Advanced",
  "summary": "Production design and platform integration across analytics + AI workflows"
}
```

## Frontend Integration

### Update Angular Environment Files

**Blog Authoring GUI:**
```typescript
// src/environments/environment.ts
export const environment = {
  production: false,
  redisApiUrl: 'http://localhost:3000/api',
  appName: 'Blog Authoring GUI'
};
```

**Portfolio App:**
```typescript
// src/environments/environment.ts
export const environment = {
  production: false,
  redisApiUrl: 'http://localhost:3000/api',
  // ... other config
};
```

For production, update to your deployed API URL:
```typescript
redisApiUrl: 'https://your-api-domain.com/api'
```

## Authentication Methods Summary

### 1. Database Password (Required for Data Operations)

**What it's for:** Reading/writing data to Redis database

**Where to get it:**
- Redis Cloud Dashboard → Your Database → Configuration
- Or set when you created the database

**Used by:** Direct Redis connection for all data operations

### 2. API Keys (Optional for Management Operations)

**What it's for:** Admin tasks like viewing database info, status, logs

**Where to get them:**
- Redis Cloud Dashboard → Account Settings → API Keys
- You need both:
  - **Account Key** (x-api-key)
  - **User Key** (x-api-secret-key)

**Used by:** Redis Cloud REST API for management operations

**Important:** API keys CANNOT replace the database password for data operations. You need both if you want to use admin features.

## Testing

Test the API server:

```bash
# Health check
curl http://localhost:3000/api/health

# Get all content
curl http://localhost:3000/api/content

# Create content
curl -X POST http://localhost:3000/api/content \
  -H "Content-Type: application/json" \
  -d '{
    "Text": "Hello World",
    "PageID": 3,
    "PageContentID": 4
  }'

# Admin: List databases (requires API keys)
curl http://localhost:3000/api/admin/databases
```

## Security Notes

- **Never commit `.env` file** to version control
- Use strong Redis passwords
- Keep API keys secure
- Enable TLS for production Redis connections
- Consider adding authentication middleware for production
- Implement rate limiting for public endpoints
- Use HTTPS in production

## Troubleshooting

### Connection Issues (Redis compatibility mode)

1. **Check Redis credentials** in `.env`
2. **Verify TLS settings** - RedisLabs requires TLS on port 15545
3. **Test connection:**
   ```bash
   redis-cli -h redis-15545.c14.us-east-1-2.ec2.cloud.redislabs.com -p 15545 --tls -a YOUR_PASSWORD ping
   ```

### API Key Issues

- Verify both Account Key and User Key are set correctly
- Check that API keys are active in Redis Cloud dashboard
- Ensure IP allow-lists (if configured) include your server IP

### Redis JSON Module Not Available

When Redis compatibility mode is enabled, the server automatically falls back to string storage if RedisJSON module is not available.

### Preview Session Errors

If preview links fail with 404/500:
1. Verify `PREVIEW_SESSIONS_TABLE_NAME` is configured.
2. Ensure the table exists with partition key `token` (String).
3. Enable DynamoDB TTL on attribute `expiresAtEpoch`.

## Deployment

For production deployment:

1. Set `NODE_ENV=production` in `.env`
2. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start src/server.js --name redis-api
   ```
3. Configure reverse proxy (nginx/Apache) if needed
4. Enable HTTPS with SSL certificates
5. Set up environment variables on your hosting platform
6. Keep `.env` file secure and never commit it

## DynamoDB Migration

To migrate existing content from the live API into DynamoDB:

```bash
AWS_PROFILE=grayson-sso node redis-api-server/scripts/migrate-content-to-ddb.js \
  --api-url https://api.grayson-wills.com/api \
  --region us-east-2 \
  --table portfolio-content
```
