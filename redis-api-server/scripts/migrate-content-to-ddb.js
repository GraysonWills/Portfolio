#!/usr/bin/env node
/**
 * One-time migration: export existing content from the running API (Redis-backed)
 * and import it into DynamoDB (portfolio-content table).
 *
 * Usage:
 *   AWS_PROFILE=grayson-sso node redis-api-server/scripts/migrate-content-to-ddb.js \
 *     --api-url https://api.grayson-wills.com/api \
 *     --region us-east-2 \
 *     --table portfolio-content
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function batchWriteAll(ddbDoc, tableName, writeRequests) {
  let pending = writeRequests.slice();
  let attempt = 0;

  while (pending.length) {
    const batch = pending.slice(0, 25);
    pending = pending.slice(25);

    const resp = await ddbDoc.send(
      new BatchWriteCommand({
        RequestItems: { [tableName]: batch }
      })
    );

    const unprocessed = resp?.UnprocessedItems?.[tableName] || [];
    if (unprocessed.length) {
      attempt++;
      if (attempt > 8) {
        throw new Error(`Too many unprocessed items after retries (${unprocessed.length} remaining)`);
      }
      const backoff = Math.min(2000, 50 * Math.pow(2, attempt));
      await sleep(backoff);
      pending = unprocessed.concat(pending);
    } else {
      attempt = 0;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const apiUrl = String(args['api-url'] || process.env.MIGRATE_API_URL || 'https://api.grayson-wills.com/api').replace(/\/$/, '');
  const region = String(args.region || process.env.AWS_REGION || process.env.DDB_REGION || 'us-east-2');
  const tableName = String(args.table || process.env.CONTENT_TABLE_NAME || 'portfolio-content');
  const dryRun = Boolean(args['dry-run']);

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch() is not available. Use Node 18+.');
  }

  console.log(`[migrate] Fetching content from ${apiUrl}/content ...`);
  const r = await fetch(`${apiUrl}/content`, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Failed to fetch content: ${r.status} ${r.statusText} ${text}`);
  }
  const items = await r.json();
  if (!Array.isArray(items)) {
    throw new Error('Expected array response from /content');
  }

  console.log(`[migrate] Retrieved ${items.length} item(s). Preparing batch write to DynamoDB table ${tableName} in ${region} ...`);

  const writeRequests = items.map(item => ({
    PutRequest: {
      Item: item
    }
  }));

  if (dryRun) {
    console.log('[migrate] Dry run enabled. Exiting without writing.');
    return;
  }

  const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true }
  });

  const start = Date.now();
  await batchWriteAll(ddbDoc, tableName, writeRequests);
  const ms = Date.now() - start;

  console.log(`[migrate] Done. Wrote ${items.length} item(s) in ${ms}ms.`);
}

main().catch(err => {
  console.error(`[migrate] ERROR: ${err?.stack || err?.message || String(err)}`);
  process.exitCode = 1;
});

