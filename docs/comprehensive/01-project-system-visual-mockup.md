# 01 - Project System Visual Mockup

This document provides a visual map of the full project platform from user-facing clients to backend services and data stores.

## 1. Platform Context

```mermaid
flowchart LR
  Visitor["Public Visitor"] --> WWW["CloudFront (www.grayson-wills.com)"]
  Author["Content Author"] --> AUTHUI["CloudFront (Blog Authoring Dev)"]

  WWW --> Portfolio["Angular Public App (portfolio-app)"]
  AUTHUI --> Authoring["Angular Authoring App (blog-authoring-gui)"]

  Portfolio --> API["API Gateway /api + Lambda handler"]
  Authoring --> API

  API --> Express["Express API runtime (redis-api-server)"]
  Express --> Content["DynamoDB: portfolio-content"]
  Express --> Preview["DynamoDB: portfolio-content-preview-sessions"]
  Express --> Subs["DynamoDB: portfolio-email-subscribers"]
  Express --> Tokens["DynamoDB: portfolio-email-tokens"]
  Express --> AssetsMeta["DynamoDB: portfolio-photo-assets"]
  Express --> AssetS3["S3: photo/media objects"]
  Express --> QueueEmail["SQS: email notifications queue"]
  Express --> QueueAnalytics["SQS: analytics events queue"]
  Express --> Sched["EventBridge Scheduler"]
  QueueEmail --> SES["SESv2 outbound email"]
  QueueAnalytics --> Lake["S3 analytics data lake"]
```

## 2. Codebase Topology

```mermaid
flowchart TB
  Repo["/Users/grayson/Desktop/Portfolio"] --> Public["portfolio-app"]
  Repo --> Authoring["blog-authoring-gui"]
  Repo --> API["redis-api-server"]
  Repo --> Ops["ops + scripts + .github/workflows"]
  Repo --> Docs["design + platform-blueprint + docs/comprehensive"]

  Public --> PublicPages["Landing / Work / Projects / Blog / Notifications"]
  Authoring --> AuthoringPages["Dashboard / Content Studio / Subscribers / Collections / Auth"]
  API --> Routes["Routes: content, notifications, subscriptions, analytics, upload, photo-assets"]
  API --> Services["Services: content-ddb, notifications, subscriptions, analytics, photo-assets-ddb"]
  Ops --> Pipelines["CI/CD, security scans, senior review workflow"]
```

## 3. Runtime Boundaries

### Frontend boundary
- `portfolio-app` consumes public read APIs and renders public pages.
- `blog-authoring-gui` consumes authenticated write APIs and admin actions.

### API boundary
- `redis-api-server` is the single backend entry point in production.
- Authenticated writes are enforced by Cognito JWT middleware on write routes.

### Data boundary
- Content and metadata are persisted in DynamoDB.
- Binary assets are persisted in S3 with signed upload flow.
- Email and analytics throughput is decoupled using SQS.

## 4. Primary User Journeys

## 4.1 Public browse journey

```mermaid
sequenceDiagram
  participant V as Visitor
  participant P as portfolio-app
  participant A as /api/content/v2
  participant D as DynamoDB content

  V->>P: Open site route
  P->>A: GET metadata-first page/cards
  A->>D: Query by PageID/PageContentID
  D-->>A: Content records
  A-->>P: card/text payload + nextToken
  P->>A: GET media batch for visible IDs
  P-->>V: Rendered page + progressive image hydration
```

## 4.2 Authoring publish journey

```mermaid
sequenceDiagram
  participant U as Author
  participant G as blog-authoring-gui
  participant API as /api/content + /api/notifications
  participant D as DynamoDB content
  participant Q as SQS notifications
  participant E as SES

  U->>G: Save post (draft/scheduled/published)
  G->>API: POST/PUT content records
  API->>D: Upsert blog records
  alt status is published + email enabled
    G->>API: POST /notifications/send-now
    API->>Q: Queue email jobs
    Q->>E: Deliver message
  else status is scheduled
    G->>API: POST /notifications/schedule
    API->>API: Create EventBridge schedule
  end
```

## 5. Visual Mockup Sections Covered

This project-level mockup intentionally separates:
- product surfaces (public site vs authoring site),
- backend entry points and middleware,
- persistence layers,
- asynchronous pipelines.

Use `02-aws-architecture-visual-mockup.md` for cloud topology detail and `03-backend-service-interplay.md` for service-level sequences.
