# Email Notifications Research + Design Package

This package covers AWS-native email notifications for new blog posts and scheduled publishes, plus the UI updates needed in both apps.

## Why This Package Exists

Current status:
- Scheduled publish metadata and worker callbacks are live.
- Blog publish notifications now enqueue to SQS and send asynchronously via a Lambda queue consumer.
- Signup confirmation email is still direct-send (not queued yet).

## Artifacts

1. Architecture + AWS services:
   - `design/email-notifications/aws-email-architecture.md`
2. Security + compliance controls:
   - `design/email-notifications/security-compliance.md`
3. UI mockups for both apps:
   - `design/email-notifications/mockups/portfolio-subscription-update.html`
   - `design/email-notifications/mockups/blog-authoring-notifications-update.html`
   - `design/email-notifications/mockups/shared.css`
   - `design/email-notifications/mockups/portfolio-subscription-update.png`
   - `design/email-notifications/mockups/blog-authoring-notifications-update.png`
4. Figma reconstruction spec:
   - `design/email-notifications/figma-handoff.md`
5. Approval gate:
   - `design/email-notifications/approval-checklist.md`

## Deferred Follow-up

1. Move `POST /api/subscriptions/request` confirmation emails to SQS queueing.
2. Add queue depth + age alarms specifically for confirmation-email workloads.
3. Add dashboard split for `publish notifications` vs `signup confirmations`.

## Scope Guardrails

1. Keep existing routes and content model intact.
2. Keep DynamoDB as source of portfolio/blog content (Redis compatibility mode remains optional only).
3. Add subscriber/notification data in AWS-managed services (not in frontend code).
4. Ship only after explicit design and architecture approval.
