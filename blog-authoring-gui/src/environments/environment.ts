/**
 * Development Environment Configuration
 */

export const environment = {
  production: false,
  // Update this to your Redis API server URL
  // For local development: http://localhost:3000/api
  // For production: https://your-api-domain.com/api
  redisApiUrl: 'http://localhost:3000/api',
  appName: 'Blog Authoring GUI',
  cognito: {
    region: 'us-east-2',
    userPoolId: 'us-east-2_dzSpoyFyI',
    clientId: '6v59a97qmb3hfl1n7ptp8npdoi'
  }
};
