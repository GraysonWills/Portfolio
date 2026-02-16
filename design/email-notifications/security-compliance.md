# Security + Compliance Plan for Blog Email Notifications

## Security Principles

1. Keep secrets and privileged operations server-side only.
2. Minimize PII retention and control access with least privilege.
3. Use explicit consent, easy unsubscribe, and auditable state changes.
4. Treat deliverability signals (bounce/complaint) as enforcement inputs.

## Key Risks and Controls

| Risk | Control |
|---|---|
| Frontend secret exposure | Remove direct provider API keys from frontend code and route through backend APIs. |
| Unauthorized mass-send | Require Cognito-authenticated admin operations for all notification send/schedule endpoints. |
| Token leakage or replay | Use opaque random tokens in emails; store only token hashes; set short TTL; rotate on use. |
| Subscription abuse/bot signups | Add rate limiting + CAPTCHA on subscribe endpoint. |
| Sending to unsubscribed users | Enforce status checks in send worker (`SUBSCRIBED` only) and process SES complaint/bounce events quickly. |
| PII over-collection | Store only email + required consent metadata, not unnecessary profile data. |

## Data Protection Standards

1. Use DynamoDB encryption at rest with KMS-managed keys.
2. Restrict table access to Lambda task roles only.
3. Encrypt API transport via HTTPS only.
4. Keep logs free of raw tokens and full email addresses (mask where possible).
5. Configure CloudWatch log retention (for example 30-90 days) to control storage and risk.

## Consent + Unsubscribe Model

1. **Double opt-in required**:
   - user submits email,
   - user confirms via emailed link,
   - only then status becomes `SUBSCRIBED`.
2. Include unsubscribe link in every campaign email.
3. Support one-click unsubscribe behavior and process promptly.
4. Keep an immutable audit trail for subscribe/unsubscribe timestamps and consent version.

## Deliverability + Sender Trust

1. Verify sending domain in SES.
2. Configure DKIM and SPF/DMARC alignment.
3. Move SES account out of sandbox before production sends.
4. Track and alert on bounce/complaint rates.

## IAM + Runtime Boundaries

1. `portfolio-redis-api` role:
   - read/write subscriber tables,
   - SES send permissions only,
   - create/delete specific Scheduler jobs.
2. Publish worker role:
   - read blog content,
   - update post status metadata,
   - send email,
   - update delivery state.
3. Deny wildcard access where practical (resource-scoped policies per table, schedule group, and SES identity).

## Compliance Notes (Operational)

1. Provide clear sender identity and mailing purpose.
2. Include physical/business contact details in outbound templates as needed.
3. Honor unsubscribe requests quickly and never require login for unsubscribe.
4. Treat legal/compliance language as policy-controlled copy (editable without code deploy where possible).

## Pre-Production Security Checklist

- [ ] Frontend has no provider secret keys.
- [ ] Subscription endpoints are rate limited and bot protected.
- [ ] Tokens are hashed at rest and TTL-expiring.
- [ ] IAM policies are least-privilege and reviewed.
- [ ] SES identity, DKIM, SPF/DMARC, and sandbox exit are complete.
- [ ] Bounce/complaint/unsubscribe event handling is wired and tested.
- [ ] Alarm thresholds and on-call notifications are configured.
