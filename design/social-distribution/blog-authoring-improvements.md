# Blog Authoring Improvements: Social Distribution

## Current Hook Points

The existing editor already branches on post status:
- `scheduled`: calls `schedulePublish(listItemID, publishDate, sendEmailUpdate, 'blog_posts')`.
- `published`: calls `sendNotificationNow(listItemID, 'blog_posts')` on publish transition.

The backend already:
- creates EventBridge one-time schedules,
- marks scheduled posts as published when the scheduler fires,
- queues email notifications,
- suppresses stale schedule execution by checking schedule names.

## Recommended Extension

1. Add a distribution intent to the save payload:
   - selected platforms
   - caption variants
   - media choice
   - quiet mode locked on
   - dry-run flag

2. Store social intents separately from blog metadata:
   - `intentId`
   - `listItemID`
   - `platform`
   - `caption`
   - `mediaUrl`
   - `status`
   - `scheduleName`
   - `externalPostId`
   - `externalPostUrl`
   - `failureReason`
   - timestamps

3. Reuse the current schedule worker:
   - immediate publish enqueues social jobs after the blog is public,
   - scheduled publish enqueues social jobs inside the scheduler callback after stale-schedule validation passes.

4. Add a new queue processor:
   - `social_publish_post`
   - idempotency key: `platform:listItemID:intentId`
   - retry with DLQ for provider outages.

## First Wave Recommendation

Fastest practical automation set:
- Bluesky
- Mastodon
- LinkedIn
- Facebook Page
- Threads
- Pinterest
- Discord webhook
- Medium or Tumblr, depending on where long-form mirrors matter

Second wave:
- Instagram
- TikTok
- X / Twitter
- YouTube

These are still feasible, but usually require more app setup, media handling, API tier choices, or review.
