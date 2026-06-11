# Figma Handoff: Social Distribution Studio

## Frames

1. `SD-01 Composer`
   - Blog post metadata and publish timing.
   - Platform target selection.
   - Quiet mode state.
   - Caption composer with per-platform variants.

2. `SD-02 Platform Matrix`
   - Connected/available/review-needed platform cards.
   - Automation speed labels.
   - Account connection state.
   - OAuth/app-review notes.

3. `SD-03 Delivery Queue`
   - Scheduled rows.
   - Per-platform delivery state.
   - Retry/cancel controls.
   - No engagement metrics.

## Responsive Notes

- Desktop: three-column platform matrix, side-by-side composer and preview.
- Tablet: two-column platform matrix, stacked composer preview.
- Mobile: platform cards become a single column and queue rows become stacked blocks.

## Production Mapping

Current integration points:
- `blog-authoring-gui/src/app/components/blog-editor/blog-editor.component.ts`
- `blog-authoring-gui/src/app/services/blog-api.service.ts`
- `redis-api-server/src/routes/notifications.js`
- `redis-api-server/src/services/notifications.js`
- `redis-api-server/src/lambda.js`

New implementation likely needs:
- `redis-api-server/src/services/social-distribution.js`
- `redis-api-server/src/routes/social-distribution.js`
- `blog-authoring-gui/src/app/pages/social-distribution/*`
- Optional shared caption helper in the authoring app.

## Data To Show

Allowed in UI:
- account connected/disconnected
- publish scheduled/queued/sent/failed
- platform post URL, optionally hidden by default
- retry count
- last failure reason

Do not show:
- likes
- comments
- replies
- shares/reposts
- views/impressions
- follower changes
