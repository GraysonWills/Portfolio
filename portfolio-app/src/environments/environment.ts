/**
 * Development Environment Configuration
 */

export const environment = {
  production: false,
  redisApiUrl: 'http://localhost:3000/api',
  useContentV2Stream: true,
  useBlogV2Cards: true,
  commentsAuth: {
    region: 'us-east-2',
    userPoolId: 'us-east-2_TA0sz2HlV',
    clientId: '4gdttn5rjq3k3jd47jltik9trd'
  },
  mailchimpApiKey: '',
  mailchimpListId: '',
  mailchimpScriptId: 'mcjs',
  linkedinProfile: {
    email: 'calvarygman@gmail.com',
    linkedin: 'www.linkedin.com/in/grayson-wills',
    website: 'www.grayson-wills.com'
  },
  aws: {
    region: '',
    ec2InstanceId: '',
    bucketName: ''
  }
};
