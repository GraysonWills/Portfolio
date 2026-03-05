# 05. Security + Operations Guardrails

## Core Security Model

- Public read endpoints stay open.
- All write/mutate paths require auth + tighter rate limits.
- Secrets remain server-side only.
- Subscriber flows use tokenized actions and hashed identifiers.

## Auth Boundary

Source: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/middleware/requireAuth.js`

- Cognito JWT validation against user pool issuer + client audience.
- Optional username allowlist for stricter admin access.
- `token_use` checks to reject invalid token types.

## Rate Limiting and Abuse Controls

Source: `/Users/grayson/Desktop/Portfolio/redis-api-server/src/app.js`

- Global API rate limiter.
- Stricter write limiter for mutation endpoints.
- Extend with WAF at CloudFront/API Gateway as traffic scales.

## DDoS and Cost-Control Strategy

1. CloudFront in front of static apps.
2. WAF managed rules + rate-based rules on CloudFront/API.
3. API throttling + usage alarms.
4. Body-size caps for uploads/JSON payloads.
5. CloudWatch alarms for request spikes and 4xx/5xx anomalies.

## Logging + Observability

- Structured request logs at API layer (`morgan` + app logs).
- CloudWatch log retention policy per environment.
- Dashboards for:
  - API health/readiness
  - SES delivery outcomes
  - Scheduler failures
  - Auth failures

## Compliance-Safe Notification Practices

- Double opt-in subscriptions.
- One-click unsubscribe links.
- Status suppression on bounce/complaint.
- Minimal PII retention (email + consent audit fields only).

## Incident Runbook Minimum

Maintain runbooks for:
1. API degradation (DynamoDB dependency failures)
2. Subscription failures (SES sandbox/config)
3. Scheduler miss/failures
4. Auth failure spikes
5. Static deploy rollback (S3 + CloudFront)
