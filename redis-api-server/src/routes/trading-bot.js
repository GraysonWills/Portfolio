/**
 * Trading Bot Routes
 *
 * Read-only windows into the AI/ML Stock Trading Bot's DynamoDB state
 * so the blog-authoring-gui can render a live operator dashboard without
 * the trading bot having to stand up its own web tier.
 *
 * Everything here reads from the six tables provisioned by the
 * TradingBotStack CDK stack in the same account (381492289909,
 * us-east-2):
 *   - positions          — currently-open positions
 *   - trades             — closed trades w/ P&L
 *   - orders             — order intents + fills
 *   - sentiment_scores   — news items + FinBERT scores
 *   - drift_metrics      — PSI rollups from drift_monitor Lambda
 *   - journal_entries    — structured trade journal
 *
 * Auth: requires a valid Cognito ID token via the shared requireAuth
 * middleware (same as /api/content writes). The AUTH_ALLOWED_USERNAMES
 * allowlist (if set) further restricts which users can query these
 * endpoints.
 *
 * Feature flag: all endpoints return 503 unless
 * TRADING_BOT_API_ENABLED=true. Keeps the routes dark until the CDK
 * stack is deployed.
 */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');

// Optional AWS SDK import — only loaded when the feature is on, so
// unrelated deploys don't need the client libs in their node_modules.
let _ddbClient = null;
function getDdbClient() {
  if (_ddbClient) return _ddbClient;
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
  const raw = new DynamoDBClient({
    region: process.env.TRADING_BOT_AWS_REGION || process.env.AWS_REGION || 'us-east-2',
  });
  _ddbClient = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return _ddbClient;
}

const TABLES = {
  positions: process.env.TRADING_BOT_POSITIONS_TABLE || 'positions',
  trades: process.env.TRADING_BOT_TRADES_TABLE || 'trades',
  orders: process.env.TRADING_BOT_ORDERS_TABLE || 'orders',
  sentiment: process.env.TRADING_BOT_SENTIMENT_TABLE || 'sentiment_scores',
  drift: process.env.TRADING_BOT_DRIFT_TABLE || 'drift_metrics',
  journal: process.env.TRADING_BOT_JOURNAL_TABLE || 'journal_entries',
};

function isEnabled() {
  return String(process.env.TRADING_BOT_API_ENABLED || '').toLowerCase() === 'true';
}

// ─── Middleware ────────────────────────────────────────────────────────
// Feature flag runs first so a disabled deploy returns 503 with no
// reliance on Cognito. Once enabled, every request must carry a valid
// Bearer token.
router.use((req, res, next) => {
  if (!isEnabled()) {
    return res.status(503).json({
      error: 'trading-bot dashboard disabled',
      hint: 'set TRADING_BOT_API_ENABLED=true after deploying the CDK stack',
    });
  }
  next();
});
router.use(requireAuth);

// ─── Helpers ───────────────────────────────────────────────────────────
async function scanTable(tableName, { limit = 100 } = {}) {
  const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
  const client = getDdbClient();
  const resp = await client.send(new ScanCommand({ TableName: tableName, Limit: limit }));
  return resp.Items || [];
}

async function getParam(name) {
  const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
  const client = new SSMClient({
    region: process.env.TRADING_BOT_AWS_REGION || process.env.AWS_REGION || 'us-east-2',
  });
  try {
    const resp = await client.send(new GetParameterCommand({ Name: name }));
    return resp.Parameter?.Value ?? null;
  } catch (e) {
    if (e.name === 'ParameterNotFound') return null;
    throw e;
  }
}

function logAndFail(res, stage, err) {
  console.error(`trading-bot ${stage} failed:`, err);
  res.status(500).json({ error: `failed to load ${stage}`, detail: String(err.message || err) });
}

// ─── Dashboard summary ─────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const [mode, killSwitch, armed, activeModel, strategyWeights] = await Promise.all([
      getParam('/trading-bot/mode'),
      getParam('/trading-bot/kill-switch'),
      getParam('/trading-bot/armed'),
      getParam('/trading-bot/active-model'),
      getParam('/trading-bot/strategy-weights'),
    ]);
    const positions = await scanTable(TABLES.positions, { limit: 200 });
    const orders = await scanTable(TABLES.orders, { limit: 50 });
    const trades = await scanTable(TABLES.trades, { limit: 50 });
    res.json({
      flags: { mode, killSwitch, armed, activeModel, strategyWeights },
      counts: {
        positions: positions.length,
        openOrders: orders.filter((o) => o.status === 'intent' || o.status === 'open').length,
        recentTrades: trades.length,
      },
      positionsPreview: positions.slice(0, 20),
      ordersPreview: orders.slice(0, 20),
      tradesPreview: trades.slice(0, 20),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logAndFail(res, 'summary', err);
  }
});

// ─── Per-table endpoints ───────────────────────────────────────────────
router.get('/positions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const items = await scanTable(TABLES.positions, { limit });
    res.json({ count: items.length, items });
  } catch (err) { logAndFail(res, 'positions', err); }
});

router.get('/orders', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const items = await scanTable(TABLES.orders, { limit });
    res.json({ count: items.length, items });
  } catch (err) { logAndFail(res, 'orders', err); }
});

router.get('/trades', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const items = await scanTable(TABLES.trades, { limit });
    res.json({ count: items.length, items });
  } catch (err) { logAndFail(res, 'trades', err); }
});

router.get('/journal', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const items = await scanTable(TABLES.journal, { limit });
    res.json({ count: items.length, items });
  } catch (err) { logAndFail(res, 'journal', err); }
});

router.get('/sentiment', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const items = await scanTable(TABLES.sentiment, { limit });
    res.json({ count: items.length, items });
  } catch (err) { logAndFail(res, 'sentiment', err); }
});

router.get('/drift', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const items = await scanTable(TABLES.drift, { limit });
    res.json({ count: items.length, items });
  } catch (err) { logAndFail(res, 'drift', err); }
});

router.get('/flags', async (req, res) => {
  try {
    const [mode, killSwitch, armed, activeModel, strategyWeights] = await Promise.all([
      getParam('/trading-bot/mode'),
      getParam('/trading-bot/kill-switch'),
      getParam('/trading-bot/armed'),
      getParam('/trading-bot/active-model'),
      getParam('/trading-bot/strategy-weights'),
    ]);
    res.json({ mode, killSwitch, armed, activeModel, strategyWeights });
  } catch (err) {
    logAndFail(res, 'flags', err);
  }
});

module.exports = router;
