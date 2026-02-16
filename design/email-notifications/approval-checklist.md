# Approval Checklist: Email Notifications + Scheduling

## Architecture Approval

- [ ] SES + EventBridge Scheduler + Lambda + DynamoDB architecture is acceptable.
- [ ] Double opt-in + unsubscribe flow is required and approved.
- [ ] Redis remains the source of post content; subscriber state is stored separately.
- [ ] Scheduled publish should auto-trigger optional email send.

## Security Approval

- [ ] Frontend secret removal (Mailchimp key in browser) is approved.
- [ ] Token hashing + TTL strategy is approved.
- [ ] IAM least-privilege model is approved.
- [ ] Bounce/complaint automation is required before full-scale sends.

## Portfolio UX Approval

- [ ] Blog page subscription card placement is approved.
- [ ] Preference center and unsubscribe route UX is approved.
- [ ] Copy/tone for subscription prompts matches your brand voice.

## Blog Authoring UX Approval

- [ ] Notification controls in editor sidebar are approved.
- [ ] Scheduled sends dashboard panel is approved.
- [ ] Publish-now vs scheduled behavior is clearly communicated in UI.

## Release Gate

- [ ] Safe to begin implementation in `redis-api-server`.
- [ ] Safe to begin implementation in `portfolio-app`.
- [ ] Safe to begin implementation in `blog-authoring-gui`.
- [ ] Safe to run deployment workflows after feature testing passes.
