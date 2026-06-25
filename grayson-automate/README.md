## Grayson Blog Reddit Automation

This Devvit app watches the public Grayson Wills blog feed and submits a link
post to the subreddit where the app is installed whenever a new blog post is
published.

Behavior:

- Polls the public blog feed once per minute.
- Uses Devvit Redis to prevent duplicate Reddit posts.
- Records the installation time without making a network request or post.
- Ignores every blog post published before the installation time.
- Publishes at most three new announcements in one run.
- Posts through the Devvit app account, not the installer's personal account.
- Includes a moderator menu action to run the sync manually.
- Keeps automation disabled by default until Reddit approves the
  `grayson-wills.com` domain exception.

The app can only post in a subreddit where it is installed. It does not provide
the normal Reddit user OAuth token expected by the Portfolio API's legacy Reddit
connector.

After Reddit approves the requested domain, enable the global
`automationEnabled` setting with the Devvit CLI or developer settings.

## Development

Use Node.js 22.

## Commands

- `npm run dev`: Starts a development server where you can develop your application live on Reddit.
- `npm run build`: Builds your client and server projects
- `npm run deploy`: Uploads a new version of your app
- `npm run launch`: Publishes your app for review
- `npm run login`: Logs your CLI into Reddit
- `npm run type-check`: Type checks, lints, and prettifies your app
