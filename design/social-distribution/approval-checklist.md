# Social Distribution Approval Checklist

## Product

- [ ] Confirm the first-wave platform list.
- [ ] Confirm whether direct post URLs should be hidden by default.
- [ ] Confirm if auto-generated captions are allowed, or only manually written captions.
- [ ] Confirm whether reposting an already published blog post should be blocked by default.
- [ ] Confirm quiet mode is mandatory, not a preference.

## Engineering

- [ ] Add a social distribution table for accounts, per-post intents, and delivery attempts.
- [ ] Add OAuth token storage using Secrets Manager or encrypted DynamoDB fields.
- [ ] Add SQS message type `social_publish_post`.
- [ ] Extend Lambda SQS routing to process social messages.
- [ ] Extend schedule payloads with selected social targets.
- [ ] Keep current email notification idempotency behavior intact.

## Privacy And Wellbeing

- [ ] Do not fetch likes.
- [ ] Do not fetch comments.
- [ ] Do not fetch replies.
- [ ] Do not fetch shares/reposts.
- [ ] Do not fetch views/impressions.
- [ ] Do not subscribe to engagement webhooks.

## Launch

- [ ] Start with one or two low-friction APIs before adding Meta/X/TikTok review work.
- [ ] Add dry-run preview mode.
- [ ] Add per-platform retry and disconnect controls.
- [ ] Log delivery failures without showing engagement metrics.
- [ ] Document platform API review requirements.
