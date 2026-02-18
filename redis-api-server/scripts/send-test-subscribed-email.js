#!/usr/bin/env node
/**
 * Send the "You're subscribed" email template to existing SUBSCRIBED recipients.
 *
 * Safe defaults:
 * - Sends to 1 recipient unless you pass --limit N or --all
 * - Supports --dry-run
 *
 * Usage:
 *   AWS_PROFILE=grayson-sso SES_FROM_EMAIL=no-reply@grayson-wills.com node redis-api-server/scripts/send-test-subscribed-email.js --limit 1
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const { sha256Hex, randomToken, maskEmail } = require('../src/utils/crypto');
const { buildSubscribedEmail } = require('../src/services/email/templates');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function getEnvOrDefault(name, fallback) {
  const v = String(process.env[name] || '').trim();
  return v ? v : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv);

  const ddbRegion = String(args.region || process.env.DDB_REGION || process.env.AWS_REGION || 'us-east-2');
  const sesRegion = String(args['ses-region'] || process.env.SES_REGION || 'us-east-1');

  const subscribersTable = String(args['subscribers-table'] || process.env.SUBSCRIBERS_TABLE_NAME || 'portfolio-email-subscribers');
  const tokensTable = String(args['tokens-table'] || process.env.TOKENS_TABLE_NAME || 'portfolio-email-tokens');
  const publicSiteUrl = String(args['site-url'] || process.env.PUBLIC_SITE_URL || 'https://www.grayson-wills.com').replace(/\/+$/, '');
  const fromEmail = getEnvOrDefault('SES_FROM_EMAIL', '');

  const dryRun = Boolean(args['dry-run']);
  const all = Boolean(args.all);
  const limit = all ? Infinity : Math.max(1, Number.parseInt(String(args.limit || '1'), 10) || 1);

  if (!fromEmail) {
    throw new Error('SES_FROM_EMAIL is required (e.g. SES_FROM_EMAIL=no-reply@grayson-wills.com)');
  }

  const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ddbRegion }), {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true }
  });
  const ses = new SESv2Client({ region: sesRegion });

  console.log(`[test-subscribed] Scanning ${subscribersTable} in ${ddbRegion} for SUBSCRIBED recipients...`);

  const recipients = [];
  let ExclusiveStartKey = undefined;
  do {
    const res = await ddbDoc.send(new ScanCommand({
      TableName: subscribersTable,
      ExclusiveStartKey,
      FilterExpression: '#status = :s AND attribute_exists(#email)',
      ExpressionAttributeNames: { '#status': 'status', '#email': 'email' },
      ExpressionAttributeValues: { ':s': 'SUBSCRIBED' },
      ProjectionExpression: 'emailHash, #email, #status'
    }));

    if (Array.isArray(res?.Items)) recipients.push(...res.Items);
    ExclusiveStartKey = res?.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // Dedupe by email (case-insensitive)
  const byEmail = new Map();
  for (const r of recipients) {
    const email = String(r.email || '').toLowerCase().trim();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, r);
  }

  const unique = Array.from(byEmail.values()).slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`[test-subscribed] Found ${byEmail.size} unique SUBSCRIBED email(s). Will send to ${unique.length}. dryRun=${dryRun}`);
  if (!unique.length) return;

  let sent = 0;
  let failed = 0;

  for (const r of unique) {
    const email = String(r.email || '').toLowerCase().trim();
    const emailHash = String(r.emailHash || '').trim();
    if (!email || !emailHash) continue;

    const token = randomToken(32);
    const tokenHash = sha256Hex(token);
    const nowIso = new Date().toISOString();
    const expiresAtEpoch = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    if (!dryRun) {
      await ddbDoc.send(new PutCommand({
        TableName: tokensTable,
        Item: {
          tokenHash,
          emailHash,
          action: 'unsubscribe',
          expiresAtEpoch,
          createdAt: nowIso
        }
      }));
    }

    const unsubscribeUrl = `${publicSiteUrl}/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
    const blogUrl = `${publicSiteUrl}/blog`;
    const { subject, text, html } = buildSubscribedEmail({ blogUrl, unsubscribeUrl });

    console.log(`[test-subscribed] -> ${maskEmail(email)} ${dryRun ? '(dry-run)' : ''}`);

    if (dryRun) {
      continue;
    }

    try {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: fromEmail,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: text, Charset: 'UTF-8' },
              Html: { Data: html, Charset: 'UTF-8' }
            }
          }
        }
      }));
      sent++;
    } catch (err) {
      failed++;
      console.error('[test-subscribed] send failed:', { to: maskEmail(email), message: String(err?.message || err) });
      await sleep(250);
    }
  }

  console.log(`[test-subscribed] Done. sent=${sent} failed=${failed}`);
}

main().catch((err) => {
  console.error(`[test-subscribed] ERROR: ${err?.stack || err?.message || String(err)}`);
  process.exitCode = 1;
});
