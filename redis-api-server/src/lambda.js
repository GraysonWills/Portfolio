/**
 * AWS Lambda handler (API Gateway HTTP API)
 */

const serverless = require('serverless-http');
const redisClient = require('./config/redis');
const { createApp } = require('./app');

const app = createApp();
const handler = serverless(app);

let redisConnectPromise = null;

async function ensureRedisConnected() {
  if (redisClient.isOpen) return;
  if (!redisConnectPromise) {
    redisConnectPromise = redisClient.connect();
  }
  await redisConnectPromise;
}

module.exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  await ensureRedisConnected();
  return handler(event, context);
};

