# Portfolio Site - Full Stack Project

A comprehensive portfolio website project consisting of an Angular frontend, Node.js/Express backend API, and a blog authoring GUI. The project uses Redis Cloud for dynamic content storage and is designed for deployment on AWS EC2 with CI/CD workflows.

## Project Structure

This repository contains three main projects:

### 1. Portfolio App (`portfolio-app/`)
The main Angular portfolio website featuring:
- Multi-page architecture (Landing, Work, Projects, Blog)
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

### 3. Blog Authoring GUI (`blog-authoring-gui/`)
Angular application for creating and managing blog posts:
- Secure authentication
- Rich text editor
- Image upload and management
- Blog post metadata management
- Direct publishing to Redis

**Tech Stack:**
- Angular 19.x
- PrimeNG 19.x
- TypeScript

## Prerequisites

- **Node.js** (LTS version 18.x or higher)
- **npm** (10.x or higher)
- **Angular CLI** (19.x or higher) - for Angular projects
- **Redis Cloud** account and database
- **Git** for version control
- **PowerShell** (for Windows setup scripts)

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd "Portfolio Site"
```

### 2. Set Up Environment Variables

Run the setup script to configure environment variables:

```powershell
.\scripts\set-env-variables.ps1
```

Or manually configure Redis API server:

```powershell
cd redis-api-server
.\setup.ps1
```

### 3. Install Dependencies

Install dependencies for each project:

```powershell
# Portfolio App
cd portfolio-app
npm install
cd ..

# Redis API Server
cd redis-api-server
npm install
cd ..

# Blog Authoring GUI
cd blog-authoring-gui
npm install
cd ..
```

### 4. Start Development Servers

**Redis API Server** (must be running first):
```powershell
cd redis-api-server
npm start
# Server runs on http://localhost:3000
```

**Portfolio App**:
```powershell
cd portfolio-app
npm start
# App runs on http://localhost:4200
```

**Blog Authoring GUI**:
```powershell
cd blog-authoring-gui
npm start
# App runs on http://localhost:4200 (or next available port)
```

## Configuration

### Redis Cloud Connection

The Redis API server connects to **Redis Cloud** (not local Redis). Configuration is done via environment variables in `redis-api-server/.env`:

```env
REDIS_HOST=redis-15545.c14.us-east-1-2.ec2.cloud.redislabs.com
REDIS_PORT=15545
REDIS_PASSWORD=your-redis-cloud-password
REDIS_TLS=true
REDIS_DB=0
```

**Note:** TLS is automatically enabled for Redis Cloud connections.

### Portfolio App Environment

Configure the portfolio app in `portfolio-app/src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  redisApiUrl: 'http://localhost:3000', // Redis API server URL
  mailchimpApiKey: 'your-mailchimp-api-key',
  mailchimpListId: 'your-mailchimp-list-id',
};
```

## Project Scripts

### Setup Scripts

- `scripts/setup.ps1` - Main setup script for the entire project
- `scripts/set-env-variables.ps1` - Configure environment variables
- `scripts/configure-credentials.ps1` - Store credentials in Windows Credential Manager
- `redis-api-server/setup.ps1` - Redis API server specific setup

### Deployment Scripts

- `scripts/deploy.ps1` - Deploy to AWS EC2

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

### PageContentID Values

- 0: Header Text
- 1: Header Icon
- 2: Footer Icon
- 3: Blog Item
- 4: Blog Text
- 5: Blog Image
- 6: Landing Photo
- 7: Landing Text
- 8: Work Text
- 9: Projects Category Photo
- 10: Projects Category Text
- 11: Projects Photo
- 12: Projects Text

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

⚠️ **Important:** This repository uses `.gitignore` to exclude sensitive files:
- `.env` files
- Credentials and keys
- Configuration files with secrets
- Build artifacts

Never commit sensitive information to the repository. Use environment variables and GitHub Secrets for production deployments.

## Development Workflow

1. **Start Redis API Server** - Must be running before portfolio app
2. **Start Portfolio App** - Main frontend application
3. **Use Blog Authoring GUI** - For creating/managing blog posts
4. **Test Locally** - All services should be accessible on localhost
5. **Commit Changes** - Use conventional commit messages
6. **Push to GitHub** - CI/CD will handle deployment

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
- Angular apps: Use `ng serve --port <port>` to specify different ports

## Support

For issues and questions:
- Email: calvarygman@gmail.com
- LinkedIn: www.linkedin.com/in/grayson-wills
- Website: www.grayson-wills.com

## License

Copyright © 2025 Grayson Wills. All rights reserved.
