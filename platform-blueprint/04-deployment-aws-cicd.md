# 04. Deployment, AWS, and CI/CD Blueprint

## Production Topology

- Public site:
  - S3 static bucket + CloudFront
- Authoring app:
  - Separate S3 static bucket + CloudFront
- API:
  - API Gateway endpoint fronting Lambda/ECS service
- Storage:
  - DynamoDB for content
  - DynamoDB for subscriber/token state
- Media:
  - S3 media bucket for uploads

## CI/CD Workflow Pattern

Source: `/Users/grayson/Desktop/Portfolio/.github/workflows/ci-cd.yml`

For each frontend app:
1. Build in CI
2. Upload hashed assets to S3 with long cache (`immutable`)
3. Upload `index.html` with `no-cache`
4. Invalidate CloudFront

For API:
- Use dedicated workflow(s) for Lambda and/or ECS deployment.
- Keep runtime version policy explicit (Node runtime lifecycle).

## Environment Separation

- `environment.ts` for local defaults
- `environment.prod.ts` for production URLs and service IDs

Source examples:
- `/Users/grayson/Desktop/Portfolio/portfolio-app/src/environments/environment*.ts`
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/environments/environment*.ts`

## Required Secret Classes

- AWS deploy roles (OIDC preferred; no long-lived keys)
- Cognito identifiers
- Scheduler webhook secret
- S3 media bucket config
- SES sender identity
- optional Redis credentials only if compatibility mode is enabled

## Operational Deployment Checklist

1. Build all affected apps locally.
2. Deploy API before frontend if route/contract changed.
3. Deploy static bundles.
4. Invalidate CloudFront.
5. Run smoke tests.
6. Verify key user journeys:
   - public page load
   - blog read
   - authoring login + content save
   - subscription flow

## Smoke Test Contract

Source script:
- `/Users/grayson/Desktop/Portfolio/scripts/smoke_prod.sh`

Validates:
- static site availability
- SEO assets (`robots.txt`, `sitemap.xml`)
- apex redirect
- API health + auth boundaries
- CORS allowlists
- private S3 direct access controls
