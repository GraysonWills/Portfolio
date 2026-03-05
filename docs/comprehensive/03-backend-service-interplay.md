# 03 - Backend Service Interplay

This document describes how backend routes and services interact, including synchronous and asynchronous paths.

## 1. Route to Service Map

| Route Prefix | Route File | Primary Services |
|---|---|---|
| `/api/content` | `src/routes/content.js` | `content-ddb`, `preview-session-ddb`, `content-index`, `media-url` |
| `/api/notifications` | `src/routes/notifications.js` | `notifications`, `subscriptions` |
| `/api/subscriptions` | `src/routes/subscriptions.js` | `subscriptions` |
| `/api/analytics` | `src/routes/analytics.js` | `analytics` |
| `/api/photo-assets` | `src/routes/photo-assets.js` | `photo-assets-ddb`, signed S3 upload flow |
| `/api/upload` | `src/routes/upload.js` | upload path + S3/public URL handling |
| `/api/admin` | `src/routes/admin.js` | Redis Cloud API helper |
| `/api/health` | `src/routes/health.js` | DynamoDB ping + optional Redis compatibility ping |
| `/media/:key` | `src/routes/media.js` | media proxy / rewrite path |

## 2. Service Dependency Graph

```mermaid
flowchart LR
  Routes["Express Routes"] --> C["content-ddb"]
  Routes --> N["notifications"]
  Routes --> S["subscriptions"]
  Routes --> A["analytics"]
  Routes --> P["photo-assets-ddb"]

  N --> C
  N --> S
  N --> EmailTpl["email/templates"]
  N --> AWS["aws/clients"]

  S --> EmailTpl
  S --> AWS
  S --> Crypto["utils/crypto"]

  A --> AWS
  P --> AWS
  C --> AWS
  Routes --> Auth["middleware/requireAuth"]
```

## 3. High-Value Sequences

## 3.1 Blog publish now with email

```mermaid
sequenceDiagram
  participant GUI as blog-authoring-gui
  participant NR as /api/notifications/send-now
  participant NS as notifications service
  participant DDB as DynamoDB
  participant SQS as SQS queue
  participant Worker as Lambda SQS consumer
  participant SES as SESv2

  GUI->>NR: POST send-now(listItemID, topic)
  NR->>NS: sendBlogPostNotification(...)
  NS->>DDB: read blog group + metadata
  NS->>DDB: write send marker lock/idempotency
  NS->>SQS: enqueue recipient email jobs
  SQS->>Worker: invoke batch
  Worker->>SES: send email payloads
```

## 3.2 Scheduled publish

```mermaid
sequenceDiagram
  participant GUI as blog-authoring-gui
  participant NR as /api/notifications/schedule
  participant NS as notifications service
  participant EB as EventBridge Scheduler
  participant L as Lambda internal handler
  participant WR as /api/notifications/worker/publish

  GUI->>NR: POST schedule(listItemID, publishAt)
  NR->>NS: schedulePublish(...)
  NS->>EB: CreateScheduleCommand
  EB->>L: fire at scheduled time
  L->>WR: signed internal webhook call
  WR->>NS: publishBlogPostNow(...)
```

## 3.3 Subscriber lifecycle

```mermaid
sequenceDiagram
  participant Public as portfolio-app notifications page
  participant SR as /api/subscriptions/*
  participant SS as subscriptions service
  participant DDB as subscriber/token tables
  participant SES as SESv2

  Public->>SR: POST /request(email, topics)
  SR->>SS: requestSubscription
  SS->>DDB: upsert PENDING + create confirm token
  SS->>SES: send confirm email
  Public->>SR: GET /confirm?token=...
  SR->>SS: confirmSubscription
  SS->>DDB: set SUBSCRIBED + consume token
```

## 3.4 Analytics pipeline

```mermaid
sequenceDiagram
  participant FE as portfolio-app
  participant AR as /api/analytics/events
  participant AS as analytics service
  participant Q as SQS analytics
  participant L as Lambda consumer
  participant S3 as S3 analytics lake

  FE->>AR: POST batched events
  AR->>AS: normalize + validate
  AS->>Q: SendMessageBatch
  Q->>L: trigger queue consumer
  L->>AS: processAnalyticsQueueRecords
  AS->>S3: write gzipped NDJSON partitions
```

## 4. Data Contracts

## 4.1 Core content record
- `ID` (PK)
- `PageID`, `PageContentID`
- `ListItemID` for grouping
- `Text`, `Photo`
- `Metadata` object
- `CreatedAt`, `UpdatedAt`

## 4.2 Collections extension (authoring only)
- namespace: `PageID=4`
- category registry: `PageContentID=16`
- entries: `PageContentID=17`
- visibility gating in metadata: `isPublic` + `visibility`.

## 5. Reliability and Guardrails in Code

- request path cache invalidates on write methods.
- write endpoints are protected by Cognito auth middleware.
- queue consumers return partial batch failures for safe redrive behavior.
- notification flow uses send markers and lock windows to reduce duplicate sends.
- health probes expose backend readiness state for DynamoDB and Redis compatibility mode (if enabled).
- `v2` read endpoints enforce bounded limits, token validation, and filter-hash guardrails.
- metadata-first + media-batch split lowers payload size on initial list route reads.

## 6. File-Level Anchors

- API composition: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/app.js`
- Lambda multiplexer: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/lambda.js`
- Content store: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/content-ddb.js`
- Notifications engine: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/notifications.js`
- Subscription engine: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/subscriptions.js`
- Analytics engine: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/analytics.js`
- Photo assets metadata: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/photo-assets-ddb.js`
