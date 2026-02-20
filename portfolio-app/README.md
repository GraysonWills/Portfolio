# Portfolio Site - Angular Application

A fully-featured, multi-page Angular portfolio website using PrimeNG, designed for deployment on AWS EC2 with CI/CD workflows via GitHub and GitLab.

## Features

- **Multi-page Architecture**: Landing, Work, Projects, and Blog pages
- **Dynamic Content Loading**: Content loaded from Redis database using PageID and PageContentID schema
- **Tokenized Preview Mode**: Supports draft overlays from authoring via `?previewToken=...` across all routes
- **LinkedIn Integration**: ATS-optimized profile data integration
- **Blog Authoring GUI**: Secure blog post creation and management
- **Mailchimp Integration**: Newsletter subscription functionality
- **PrimeNG UI Components**: Modern, responsive UI with animations
- **CI/CD Pipelines**: Automated deployment via GitHub Actions and GitLab CI

## Prerequisites

- Node.js (LTS version 22.x or higher)
- npm (10.x or higher)
- Angular CLI (19.x or higher)
- Redis database access
- AWS EC2 instance (for deployment)
- GitHub and/or GitLab accounts (for CI/CD)

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd portfolio-app
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy `src/environments/environment.ts` and update with your configuration:

```typescript
export const environment = {
  production: false,
  redisApiUrl: 'http://your-redis-api-url',
  mailchimpApiKey: 'your-mailchimp-api-key',
  mailchimpListId: 'your-mailchimp-list-id',
  // ... other configurations
};
```

### 4. Start Development Server

```bash
npm start
```

Navigate to `http://localhost:4200/`

## Project Structure

```
portfolio-app/
├── src/
│   ├── app/
│   │   ├── components/          # Shared components (Header, Footer)
│   │   ├── pages/               # Page components (Landing, Work, Projects, Blog)
│   │   ├── models/              # Data models and interfaces
│   │   ├── services/            # Services (Redis, LinkedIn, Mailchimp)
│   │   └── app.module.ts        # Root module
│   ├── assets/                  # Static assets
│   └── environments/            # Environment configurations
├── .github/
│   └── workflows/               # GitHub Actions CI/CD
├── scripts/                     # PowerShell setup and deployment scripts
└── README.md                    # This file
```

## Redis Data Schema

The application uses a Redis database with the following schema:

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

## LinkedIn Integration

The application integrates LinkedIn profile data for ATS optimization:

- **Contact Information**: Email, LinkedIn URL, Website
- **Top Skills**: Statistics, Solution Architecture, Data Architecture
- **Certifications**: DFSS Green Belt
- **Experience**: Career timeline with achievements
- **Education**: Academic degrees and institutions

## CI/CD Configuration

### GitHub Actions

The GitHub Actions workflow (`/.github/workflows/ci-cd.yml`) automates:

1. Code checkout
2. Dependency installation
3. Linting and testing
4. Production build
5. Deployment to EC2

**Required Secrets:**
- `REDIS_API_URL`
- `MAILCHIMP_API_KEY`
- `MAILCHIMP_LIST_ID`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `EC2_HOST`
- `EC2_USER`
- `EC2_SSH_KEY`

### GitLab CI

The GitLab CI configuration (`/.gitlab-ci.yml`) provides similar functionality with GitLab-specific features.

**Required Variables:**
- Same as GitHub Actions secrets

## PowerShell Scripts

### Setup Script

Automated setup script for Windows:

```powershell
.\scripts\setup.ps1
```

This script:
- Verifies Node.js and npm installation
- Installs Angular CLI if needed
- Checks AWS, GitHub, GitLab CLI installations
- Backs up existing codebase
- Installs project dependencies

### Deployment Script

Deploy to AWS EC2:

```powershell
.\scripts\deploy.ps1 -Environment production -EC2Host <your-ec2-host> -SSHKeyPath <path-to-ssh-key>
```

### Credential Configuration

Store credentials in Windows Credential Manager:

```powershell
.\scripts\configure-credentials.ps1 -All
```

## Blog Authoring GUI

The blog authoring GUI (separate repository) provides:

- Secure login and authentication
- WYSIWYG rich text editor
- Image upload and management
- Blog post metadata (title, summary, tags, publish date)
- Redis connectivity for content storage

## Mailchimp Integration

Mailchimp script is automatically loaded on application startup:

```html
<script id="mcjs">!function(c,h,i,m,p){m=c.createElement(h),p=c.getElementsByTagName(h)[0],m.async=1,m.src=i,p.parentNode.insertBefore(m,p)}(document,"script","https://chimpstatic.com/mcjs-connected/js/users/d5c7a1745f36c9abf37462301/2faf87c3c0a1724830876c92b.js");</script>
```

## Building for Production

```bash
npm run build -- --configuration=production
```

The production build will be in `dist/portfolio-app/`

## Testing

```bash
# Unit tests
npm test

# E2E tests (if configured)
npm run e2e
```

## Deployment

### Manual Deployment

1. Build the application:
   ```bash
   npm run build -- --configuration=production
   ```

2. Deploy to EC2:
   ```bash
   scp -r dist/portfolio-app/* user@ec2-host:/var/www/portfolio-app/
   ```

3. Restart web server:
   ```bash
   ssh user@ec2-host 'sudo systemctl restart nginx'
   ```

### Automated Deployment

Use the provided PowerShell scripts or CI/CD pipelines for automated deployment.

## Troubleshooting

### Redis Connection Issues

1. Verify Redis API URL in environment configuration
2. Check network connectivity to Redis server
3. Verify Redis credentials are correct

### Build Errors

1. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. Clear Angular cache:
   ```bash
   ng cache clean
   ```

### Deployment Issues

1. Verify SSH key permissions
2. Check EC2 security group settings
3. Verify nginx configuration
4. Check file permissions on EC2

## Support

For issues and questions:
- Email: calvarygman@gmail.com
- LinkedIn: www.linkedin.com/in/grayson-wills
- Website: www.grayson-wills.com

## License

Copyright © 2025 Grayson Wills. All rights reserved.
