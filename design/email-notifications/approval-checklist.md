# Email Notifications Status Checklist

Last updated: 2026-03-04

## Implemented

- [x] Double opt-in request/confirm/unsubscribe API flow is live.
- [x] Subscriber/token state is stored in DynamoDB tables.
- [x] Blog publish notification path is queue-backed (SQS -> SES worker).
- [x] Authoring has send-now and schedule controls wired to backend routes.
- [x] Portfolio includes subscribe + notification management routes.
- [x] Duplicate subscription handling returns explicit states.
- [x] Branded logo URL support exists for outbound template rendering (`EMAIL_BRAND_LOGO_URL`).

## Partially Implemented

- [ ] Signup confirmation emails are still direct-send (not queue-backed yet).
- [ ] Bounce/complaint lifecycle to `BOUNCED`/`COMPLAINED` states requires full SNS feedback integration verification.

## Pending Hardening

- [ ] Queue depth/age CloudWatch alarms for email queues.
- [ ] Dashboard split and operational metrics for `publish notifications` vs `signup confirmations`.
- [ ] End-to-end load test for high-volume send windows.

