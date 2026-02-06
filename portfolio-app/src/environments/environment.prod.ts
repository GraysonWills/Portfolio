/**
 * Production Environment Configuration
 * 
 * Values are replaced at build time via CI/CD pipeline.
 * Set these in your deployment environment or GitHub Secrets.
 * The build step should replace this file or inject values.
 */

export const environment = {
  production: true,
  redisApiUrl: 'https://api.grayson-wills.com/api',
  mailchimpApiKey: '',
  mailchimpListId: '',
  mailchimpScriptId: 'mcjs',
  linkedinProfile: {
    email: 'calvarygman@gmail.com',
    linkedin: 'www.linkedin.com/in/grayson-wills',
    website: 'www.grayson-wills.com'
  },
  aws: {
    region: 'us-east-1',
    ec2InstanceId: '',
    bucketName: ''
  }
};
