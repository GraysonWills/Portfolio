/**
 * AWS SDK clients (v3)
 *
 * Keep these as singletons to minimize cold-start overhead in Lambda.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { SESv2Client } = require('@aws-sdk/client-sesv2');
const { SchedulerClient } = require('@aws-sdk/client-scheduler');

function getAwsRegion() {
  return process.env.AWS_REGION || process.env.S3_UPLOAD_REGION || 'us-east-2';
}

function getSesRegion() {
  // SES production access is regional; keep this override separate from the app region.
  return process.env.SES_REGION || getAwsRegion();
}

let ddbDoc = null;
function getDdbDoc() {
  if (ddbDoc) return ddbDoc;

  const client = new DynamoDBClient({ region: getAwsRegion() });
  ddbDoc = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      // Keep behavior predictable and avoid writing empty/null attributes.
      removeUndefinedValues: true,
      convertClassInstanceToMap: true
    }
  });
  return ddbDoc;
}

let ses = null;
function getSes() {
  if (ses) return ses;
  ses = new SESv2Client({ region: getSesRegion() });
  return ses;
}

let scheduler = null;
function getScheduler() {
  if (scheduler) return scheduler;
  scheduler = new SchedulerClient({ region: getAwsRegion() });
  return scheduler;
}

module.exports = {
  getAwsRegion,
  getSesRegion,
  getDdbDoc,
  getSes,
  getScheduler,
};
