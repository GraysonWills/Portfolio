# 03. Data Models + State Strategy

## Content Model (Primary Website Data)

Canonical shape (used by frontend + authoring + API):

- `ID` (string): unique content record ID
- `Text` (string, optional)
- `Photo` (string, optional)
- `ListItemID` (string): groups records into one logical item
- `PageID` (number): page bucket
- `PageContentID` (number): semantic content role
- `Metadata` (object): typed auxiliary data (status, tags, order, etc.)
- `CreatedAt`, `UpdatedAt`

Reuse rule:
- Treat this as the shared contract between frontend rendering and authoring writes.
- Evolve by adding optional metadata fields, not by breaking existing fields.

## Content Storage Strategy

Source:
- `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/content.js`
- `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/content-ddb.js`

Modes:
- `CONTENT_BACKEND=dynamodb` (recommended/default in production)
- `CONTENT_BACKEND=redis` (compatibility/fallback mode)

Pattern:
- API routes abstract the backend so frontend contracts stay stable.
- Keep indexes/query paths in backend service layer.

## Preview Session Model

Purpose:
- Authoring app can preview draft/unpublished changes on public site without hard-publishing.

Key behavior:
- API creates short-lived preview token with upserts/deletes payload.
- Public site reads preview payload by token and overlays content.
- TTL controls expiration and blast radius.

## Email Subscription Model

Sources:
- `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/subscriptions.js`
- `/Users/grayson/Desktop/Portfolio/redis-api-server/src/services/notifications.js`

Tables:
- `portfolio-email-subscribers`
  - PK `emailHash`
  - status lifecycle: `PENDING|SUBSCRIBED|UNSUBSCRIBED|BOUNCED|COMPLAINED`
  - consent/audit fields
- `portfolio-email-tokens`
  - PK `tokenHash`
  - action: `confirm|unsubscribe|manage`
  - TTL expiration

Duplicate prevention:
- Subscription request checks existing status first.
- Returns explicit `ALREADY_SUBSCRIBED` / `ALREADY_PENDING` states.

## State Ownership Rules

- Public site owns presentation state only.
- Authoring app owns edit-session state.
- API owns durable business state transitions (publish status, schedule status, subscription state).
- Scheduler/worker owns deferred transition execution.
