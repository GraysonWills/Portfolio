/**
 * Production Environment Configuration
 */

export const environment = {
  production: true,
  // HTTPS via `tailscale serve` on the Spark (tailnet-only, real LE cert) —
  // the https:// studio can't fetch http:// (mixed content). Requires the
  // browser's device to resolve MagicDNS names ("Use Tailscale DNS" on).
  meshApiUrl: 'https://spark-0a8b.tailf96049.ts.net',
  redisApiUrl: 'https://api.grayson-wills.com/api',
  useContentV2Stream: true,
  useBlogV2Cards: true,
  portfolioPreviewUrl: 'https://www.grayson-wills.com',
  appName: 'Blog Authoring GUI',
  cognito: {
    region: 'us-east-2',
    userPoolId: 'us-east-2_dzSpoyFyI',
    clientId: '6v59a97qmb3hfl1n7ptp8npdoi',
    hostedUiDomain: '',
    redirectSignIn: 'https://author.grayson-wills.com/login'
  }
};
