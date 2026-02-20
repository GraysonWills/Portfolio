/**
 * Production Environment Configuration
 */

export const environment = {
  production: true,
  redisApiUrl: 'https://api.grayson-wills.com/api',
  portfolioPreviewUrl: 'https://www.grayson-wills.com',
  appName: 'Blog Authoring GUI',
  cognito: {
    region: 'us-east-2',
    userPoolId: 'us-east-2_dzSpoyFyI',
    clientId: '6v59a97qmb3hfl1n7ptp8npdoi'
  }
};
