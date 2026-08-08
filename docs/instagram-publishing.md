# Instagram publishing (the AWS half)

This backend is the only thing that holds Instagram credentials and the only
thing that talks to Meta. The local worker mesh decides *what* to post and
*when*; it then hands the finished media and an exact package here. Written
2026-08-08, when the path went live.

The mesh-side design lives in the `total-agentic-workflow` repo as
**ADR-034: Instagram posting pipeline**.

## Why the mesh cannot post directly

Instagram ingests media only from publicly fetchable HTTPS URLs. The mesh
stores artifacts in MinIO on a tailnet, which Meta can never reach. So media
is uploaded here first, and this service posts as the connected account.

## The three tools the mesh calls

All on the MCP endpoint (`POST /api/mcp`, bearer `mcp_…`), defined in
`src/services/mcp-tools.js`.

| Tool | Scope | Purpose |
| --- | --- | --- |
| `media.request_upload_url` | `media:write:draft` | Presigned S3 PUT for one file, images or video up to 1 GB. Returns `uploadUrl` + the `publicUrl` it will have. |
| `media.confirm_upload` | `media:write:draft` | HEADs the object and marks the asset ready. |
| `social.schedule_delivery` | `social:write:send` | Creates and sends one delivery. Bypasses the studio review queue — grant only to automation that gates upstream. |

Presigned upload exists because the Lambda payload ceiling (~6 MB) makes
base64 impossible for video, and a Reel can run to 1 GB.

Poll `social.list_deliveries` with a `deliveryId` (scope `social:read`) to
follow an async send.

### providerOptions.instagram

`social.schedule_delivery` takes a typed options object:

```jsonc
{
  "igMediaType": "feed" | "carousel" | "reel" | "story",
  "items": [{
    "mediaUrl":  "https://…",          // public HTTPS, required
    "mediaType": "image/jpeg" | "video/mp4",
    "userTags":  [{ "username": "someone", "x": 0.25, "y": 0.75 }],
    "altText":   "…"                    // images only
  }],
  "collaborators": ["username"],        // max 3
  "locationId":    "…",                 // a Facebook place ID
  "coverUrl":      "https://…",         // reels: explicit cover, or…
  "thumbOffsetMs": 1500,                //   …a frame offset
  "shareToFeed":   true                 // reels only
}
```

Photo tags carry normalized x/y; Reel tags are usernames only. Stories accept
no caption, tags, collaborators, or location — the API rejects them, so the
mesh's gate refuses to build such a package in the first place.

## How a post actually executes

`postToInstagram` in `src/services/social-distribution.js` runs Meta's
container flow: create a container per item, poll `status_code` until
`FINISHED`, then `media_publish`, then fetch the `permalink` for the receipt.
Carousels create one child container per item and a parent that references
them.

**Sync vs async.** A single image posts inline. Reels and carousels can
process on Meta's side well past API Gateway's 29-second ceiling, so those are
handed to a one-shot EventBridge schedule (~10 s out) that re-enters via
`lambda.js` → `kind: 'social_distribution_send'` → `sendDeliveryById`, where no
HTTP timeout applies. The caller polls for the result.

**Crash safety.** The container id is checkpointed onto the delivery record as
`igCreationId` before publishing. A retried send publishes the existing
container instead of re-uploading — containers stay valid for 24 hours.

## What this depends on

- **A connected Instagram credential with a selected account.** "Connected" is
  not sufficient: `getPostingCredential` throws 409 for Instagram when
  `selectedAccount.id` is missing, and the adapter needs that ID as the post
  target. Facebook, Pinterest, and Tumblr share this rule.
- **`instagram_business_content_publish`** in the granted scopes.
- **Long-lived token upkeep.** Instagram tokens last 60 days and refresh during
  studio provider-status checks. Those are GETs on `/api/social-auth`, so
  anything that blocks those reads silently stops the refresh clock.
- **EventBridge**: `SCHEDULER_TARGET_LAMBDA_ARN` and `SCHEDULER_INVOKE_ROLE_ARN`
  must be set (`api-deploy.yml` fails the deploy without them) and the schedule
  group must exist (`SOCIAL_DISTRIBUTION_SCHEDULER_GROUP_NAME`, default
  `portfolio-email`).
- **Media storage**: `PHOTO_ASSETS_BUCKET`, `PHOTO_ASSETS_TABLE_NAME`, and
  ideally `PHOTO_ASSETS_CDN_BASE_URL`.

## Deliberately not supported

Product/shopping tags, hashtag search, and location *search* require the
Facebook-Login variant with a linked Page; this app uses Instagram Login.
Story stickers, polls, link stickers, and licensed Reel audio have no API at
all. There is no filter concept in the Instagram API — the mesh bakes looks
into the pixels with ffmpeg before upload.

## Rate limits

Instagram allows roughly 100 API-published posts per rolling 24 hours per
account; a carousel counts as one. On this side, `social.schedule_delivery` is
categorized `externalMutation` and draws on its own per-client daily bucket
(it previously fell through to the read bucket).
