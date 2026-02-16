# Email Notifications Research + Design Package

This package covers how to add AWS-native email notifications for new blog posts and scheduled publishes, plus the UI updates needed in both apps before production rollout.

## Why This Package Exists

Current code has scheduling controls in the UI, but publish behavior is still forced to immediate publish:

- `blog-authoring-gui/src/app/components/blog-editor/blog-editor.component.ts` collects `status` and `publishDate`.
- `blog-authoring-gui/src/app/services/blog-api.service.ts` currently writes `status: 'published'` and `publishDate: new Date()` on create/update.

That means scheduling is visible in the UI but not fully enforced in the backend pipeline yet.

## Artifacts

1. Architecture + AWS services:
   - `design/email-notifications/aws-email-architecture.md`
2. Security + compliance controls:
   - `design/email-notifications/security-compliance.md`
3. UI mockups for both apps:
   - `design/email-notifications/mockups/portfolio-subscription-update.html`
   - `design/email-notifications/mockups/blog-authoring-notifications-update.html`
   - `design/email-notifications/mockups/shared.css`
4. Figma reconstruction spec:
   - `design/email-notifications/figma-handoff.md`
5. Approval gate:
   - `design/email-notifications/approval-checklist.md`

## Scope Guardrails

1. Keep existing routes and content model intact.
2. Keep Redis as source of portfolio/blog content.
3. Add subscriber/notification data in AWS-managed services (not in frontend code).
4. Ship only after explicit design and architecture approval.
