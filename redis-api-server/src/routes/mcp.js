const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const requireAuth = require('../middleware/requireAuth');
const requireMcpAuth = require('../middleware/requireMcpAuth');
const mcpControl = require('../services/mcp-control');
const { buildMcpServer, executeApproval } = require('../services/mcp-tools');

const router = express.Router();

router.get('/clients', requireAuth, async (req, res) => {
  try {
    return res.json(await mcpControl.listClients(req.user));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.post('/clients', requireAuth, async (req, res) => {
  try {
    const result = await mcpControl.createClient(req.body || {}, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.delete('/clients/:clientId', requireAuth, async (req, res) => {
  try {
    return res.json(await mcpControl.revokeClient(req.params.clientId, req.user));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.get('/approvals', requireAuth, async (req, res) => {
  try {
    return res.json(await mcpControl.listApprovals(req.user, {
      status: req.query.status || '',
      limit: req.query.limit || 100,
    }));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.post('/approvals/:approvalId/approve', requireAuth, async (req, res) => {
  try {
    const result = await executeApproval(req.params.approvalId, req.user);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.post('/approvals/:approvalId/reject', requireAuth, async (req, res) => {
  try {
    const approval = await mcpControl.decideApproval({
      approvalId: req.params.approvalId,
      decision: 'rejected',
      reviewerUser: req.user,
      error: String(req.body?.reason || '').trim(),
    });
    return res.json({ approval });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

router.get('/health', requireAuth, (_req, res) => {
  return res.json({
    ok: true,
    transport: 'streamable-http',
    endpoint: '/api/mcp',
    tableName: mcpControl.getTableName(),
  });
});

function normalizeMcpTransportHeaders(req) {
  const normalizedHeaders = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };

  for (const [key, value] of Object.entries(normalizedHeaders)) {
    req.headers[key] = value;
  }

  if (Array.isArray(req.rawHeaders)) {
    const nextRawHeaders = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = String(req.rawHeaders[i] || '');
      if (Object.prototype.hasOwnProperty.call(normalizedHeaders, key.toLowerCase())) continue;
      nextRawHeaders.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    }
    nextRawHeaders.push('Accept', normalizedHeaders.accept);
    nextRawHeaders.push('Content-Type', normalizedHeaders['content-type']);
    req.rawHeaders = nextRawHeaders;
  }

  if (req.headersDistinct && typeof req.headersDistinct === 'object') {
    req.headersDistinct.accept = [normalizedHeaders.accept];
    req.headersDistinct['content-type'] = [normalizedHeaders['content-type']];
  }
}

async function handleMcp(req, res) {
  let server = null;
  try {
    // API Gateway/CloudFront can normalize or omit Accept in ways that fail the
    // SDK's strict Streamable HTTP negotiation. This route is already protected
    // by MCP bearer auth, so make the supported response types explicit.
    normalizeMcpTransportHeaders(req);
    server = buildMcpServer(req.mcpClient);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] Request failed:', err?.message || err);
    if (!res.headersSent) {
      res.status(err.status || 500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: err?.message || 'MCP request failed',
        },
        id: req.body?.id ?? null,
      });
    }
  } finally {
    if (server && typeof server.close === 'function') {
      await server.close().catch(() => {});
    }
  }
}

router.post('/', requireMcpAuth, handleMcp);
router.get('/', requireMcpAuth, handleMcp);
router.delete('/', requireMcpAuth, handleMcp);

module.exports = router;
