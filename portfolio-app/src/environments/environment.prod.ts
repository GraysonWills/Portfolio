/**
 * Production Environment Configuration
 */

export const environment = {
  production: true,
  redisApiUrl: process.env['REDIS_API_URL'] || '',
  mailchimpApiKey: process.env['MAILCHIMP_API_KEY'] || '',
  mailchimpListId: process.env['MAILCHIMP_LIST_ID'] || '',
  mailchimpScriptId: 'mcjs',
  linkedinProfile: {
    email: 'calvarygman@gmail.com',
    linkedin: 'www.linkedin.com/in/grayson-wills',
    website: 'www.grayson-wills.com'
  },
  aws: {
    region: process.env['AWS_REGION'] || '',
    ec2InstanceId: process.env['AWS_EC2_INSTANCE_ID'] || '',
    bucketName: process.env['AWS_BUCKET_NAME'] || ''
  }
};
