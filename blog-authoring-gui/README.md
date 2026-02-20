# Blog Authoring GUI

A secure, standalone Angular application for creating and managing blog posts that publish directly to the Redis-backed portfolio site.

## Features

- **Secure Login** — Username/password authentication with local credential storage and session management (24-hour expiry).
- **WYSIWYG Editor** — Rich text editing via PrimeNG's Quill-based editor with full formatting support.
- **Image Handling** — Drag-and-drop image uploader with automatic client-side compression, resize (max 1200×800), and preview before upload.
- **Post Metadata** — Title, summary, tags, publish date, status (draft / scheduled / published), and category assignment.
- **ListItemID Pairing** — Text and image content are automatically paired via matching `ListItemID`, consistent with the portfolio's Redis schema.
- **Redis Connectivity** — Configurable API endpoint, connection testing with visual status indicator, and robust error feedback.
- **Confirmation Dialogs** — PrimeNG `ConfirmDialog` for publish, edit, delete, and discard-changes actions.
- **Transaction Log** — All create, update, delete, and config-change operations are logged and persisted in the browser for audit review.
- **CloudFront Full-Site Preview** — Generate draft preview sessions and open the deployed portfolio routes (`/`, `/work`, `/projects`, `/blog`, `/blog/:id`) without publishing.

## Prerequisites

- Node.js 18+ and npm
- Angular CLI 19.x (`npm install -g @angular/cli`)
- A running instance of the **redis-api-server** (see `../redis-api-server/`)

## Setup

1. **Install dependencies:**

   ```bash
   cd blog-authoring-gui
   npm install
   ```

2. **Configure the API endpoint:**

   Edit `src/environments/environment.ts` and set `redisApiUrl` to your Redis API server address:

   ```ts
   export const environment = {
     production: false,
     redisApiUrl: 'http://localhost:3000/api'
   };
   ```

   You can also change this at runtime via the **Settings** gear icon on the dashboard.

3. **Start the dev server:**

   ```bash
   ng serve --port 4201
   ```

   Navigate to `http://localhost:4201/`.

## Authentication

On first launch, you'll see a login screen. The **first credentials you enter** become your stored credentials (there is no server-side auth — this is a local authoring tool). Subsequent logins must match those credentials.

To reset credentials: clear `blog_authoring_credentials` from your browser's localStorage.

Sessions expire after 24 hours.

## Creating a Blog Post

1. Click **Create New Post** on the dashboard.
2. Fill in the required fields: Title, Summary, and Content (rich text).
3. Optionally add a featured image (drag-and-drop or click to select). Images are automatically compressed and resized before upload.
4. Add tags by typing and pressing Enter.
5. Set the publish date, status, and category.
6. Click **Save Post** and confirm in the dialog.

The post is written to Redis as paired content entries (text + optional image) under `PageID: 3` (Blog), linked by a shared `ListItemID`.

## Editing & Deleting Posts

- Click **Edit** on any post card to re-open it in the editor.
- Click **Delete** to permanently remove a post (confirmation required).
- If you have unsaved changes and click Cancel, you'll be prompted to discard or keep editing.

## Cloud Preview Workflow

- In **Blog Editor**, use `Preview on Site (Card)` or `Preview on Site (Full)` to open CloudFront preview routes with unsaved draft data.
- In **Dashboard**, each post includes `Site Card` and `Site Full` preview actions.
- In **Content Studio**, click `Preview in Site` (or `Preview Draft in Site` inside the editor dialog) to preview non-blog page changes on deployed routes.
- Preview links use short-lived tokenized sessions from the API and do not publish content.

## Redis Connection Settings

Click the **gear icon** in the dashboard header to open the settings panel. Enter your Redis API endpoint URL and click **Save & Test**. The connection badge in the header shows real-time status:

- Green: Connected
- Red: Disconnected
- Yellow: Testing...

## Transaction Log

Click the **list icon** in the dashboard header to view the transaction log. All write operations (create, update, delete) and configuration changes are recorded with timestamps. The log persists in localStorage (max 200 entries).

## Troubleshooting

| Issue | Solution |
|---|---|
| **"Could not verify Redis connection"** | Ensure `redis-api-server` is running and the endpoint URL is correct. Check for CORS issues. |
| **Login credentials forgotten** | Clear `blog_authoring_credentials` from localStorage in browser DevTools. |
| **Image upload fails** | The server may not have an `/upload/image` endpoint; the app falls back to base64 encoding. Check file size (max 10MB raw). |
| **Editor content not saving** | Verify the Redis API server is accepting POST requests at `/content/batch`. Check browser console for errors. |
| **Session expired** | Re-login. Sessions last 24 hours. Clear `blog_authoring_session` from localStorage if issues persist. |

## Project Structure

```
src/
├── app/
│   ├── components/
│   │   ├── blog-editor/      # WYSIWYG post editor with metadata fields
│   │   ├── image-uploader/   # Drag-and-drop image upload with compression
│   │   └── login/            # Authentication login form
│   ├── models/
│   │   └── redis-content.model.ts  # TypeScript interfaces (PageID, PageContentID, etc.)
│   ├── pages/
│   │   └── dashboard/        # Main dashboard with post list, settings, log
│   └── services/
│       ├── auth.service.ts          # Local credential/session management
│       ├── blog-api.service.ts      # Redis API HTTP client
│       └── transaction-log.service.ts  # Operation audit logging
├── environments/
│   ├── environment.ts         # Dev config (redisApiUrl)
│   └── environment.prod.ts    # Production config
└── styles.scss                # Global styles
```

## Building for Production

```bash
ng build --configuration production
```

Output is written to `dist/blog-authoring-gui/`. Deploy the contents to any static file server or bundle with Electron for a desktop experience.
