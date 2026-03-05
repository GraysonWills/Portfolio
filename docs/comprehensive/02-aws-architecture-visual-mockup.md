# 02 - AWS Architecture Visual Mockup

This document maps the AWS runtime topology, deployment pathways, and operational boundaries.

## 1. Cloud Topology

```mermaid
flowchart LR
  subgraph Edge["Edge Layer"]
    CFW["CloudFront: E28CZKZOGGZGVK (www)"]
    CFB["CloudFront: E31OPQLJ4WFI66 (blog authoring)"]
  end

  subgraph Static["Static Hosting"]
    S3W["S3: www.grayson-wills.com"]
    S3B["S3: grayson-wills-blog-authoring-dev-381492289909"]
  end

  subgraph APIPlane["API Plane (us-east-2)"]
    APIGW["API Gateway: api.grayson-wills.com /api"]
    LMB["Lambda: portfolio-redis-api"]
  end

  subgraph Data["Data + Messaging"]
    DDBContent["DynamoDB: portfolio-content"]
    DDBPreview["DynamoDB: portfolio-content-preview-sessions"]
    DDBSubs["DynamoDB: portfolio-email-subscribers"]
    DDBTokens["DynamoDB: portfolio-email-tokens"]
    DDBAssets["DynamoDB: portfolio-photo-assets"]
    S3Assets["S3: photo assets/media"]
    SQSEmail["SQS: email queue"]
    SQSAnalytics["SQS: analytics queue"]
    S3Analytics["S3: analytics landing zone"]
  end

  subgraph Comms["Outbound Comms + Scheduling"]
    SES["SESv2"]
    Scheduler["EventBridge Scheduler"]
    SNS["SNS feedback (bounce/complaint)"]
  end

  CFW --> S3W
  CFB --> S3B
  CFW --> APIGW
  CFB --> APIGW
  APIGW --> LMB
  LMB --> DDBContent
  LMB --> DDBPreview
  LMB --> DDBSubs
  LMB --> DDBTokens
  LMB --> DDBAssets
  LMB --> S3Assets
  LMB --> SQSEmail
  LMB --> SQSAnalytics
  SQSEmail --> SES
  SQSAnalytics --> S3Analytics
  LMB --> Scheduler
  SNS --> LMB
```

## 2. CI/CD to AWS

## 2.1 Frontend deploy flow (`.github/workflows/ci-cd.yml`)

```mermaid
sequenceDiagram
  participant GH as GitHub Actions
  participant OIDC as AWS OIDC role
  participant S3 as S3 static buckets
  participant CF as CloudFront

  GH->>GH: Build/test portfolio-app + blog-authoring-gui
  GH->>OIDC: Assume deploy role via OIDC
  GH->>S3: Sync hashed assets (long cache)
  GH->>S3: Upload index/favicon (no-store)
  GH->>CF: Invalidate shell routes
  GH-->>GH: Run smoke tests
```

## 2.2 API deploy flow (`.github/workflows/api-deploy.yml`)

```mermaid
sequenceDiagram
  participant GH as GitHub Actions
  participant OIDC as AWS OIDC role
  participant ZIP as Lambda package
  participant L as Lambda portfolio-redis-api

  GH->>GH: npm ci --omit=dev
  GH->>ZIP: Build redis-api-lambda.zip
  GH->>OIDC: Assume API deploy role
  GH->>L: Update runtime check/upgrade (nodejs22.x)
  GH->>L: Update function code
```

## 3. Runtime Security and Reliability Controls

### Edge + static
- CloudFront in front of both public and authoring sites.
- SPA shell invalidations target route entry points.
- HTML and favicon served no-cache; hashed JS/CSS immutable cache.

### API process controls
- `helmet`, CORS allowlist, compression.
- Rate limiting:
  - general `/api/*` limiter
  - stricter write limiter
  - dedicated analytics limiter.
- bounded request body parsing (`2mb` limits).

### Data + queue controls
- DynamoDB for source-of-truth records.
- SQS for asynchronous email and analytics throughput.
- EventBridge Scheduler for scheduled publish notifications.
- SNS ingestion path for SES bounce/complaint updates.

## 4. AWS Resource Inventory (Current Naming in Repo)

| Category | Resource | Source |
|---|---|---|
| Public distribution | `E28CZKZOGGZGVK` | `ci-cd.yml` |
| Authoring distribution | `E31OPQLJ4WFI66` | `ci-cd.yml` |
| Public bucket | `www.grayson-wills.com` | `ci-cd.yml` |
| Authoring bucket | `grayson-wills-blog-authoring-dev-381492289909` | `ci-cd.yml` |
| API Lambda | `portfolio-redis-api` | `api-deploy.yml` |
| API region | `us-east-2` | workflows + code defaults |
| Content table | `portfolio-content` | README + runtime env |
| Preview table | `portfolio-content-preview-sessions` | README + runtime env |
| Subscriber table | `portfolio-email-subscribers` | notifications/subscriptions services |
| Token table | `portfolio-email-tokens` | notifications/subscriptions services |
| Photo assets table | `portfolio-photo-assets` | photo-assets service |

## 5. Suggested Diagram Update Process

1. Update Markdown diagram first when architecture changes.
2. Regenerate matching Word documentation in `/Users/grayson/Desktop/Portfolio/docs/comprehensive/word`.
3. Validate workflow names, bucket names, and distribution IDs against `.github/workflows`.
4. Keep region assumptions explicit (`us-east-2` unless intentionally changed).
