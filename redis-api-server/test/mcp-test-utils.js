const http = require('node:http');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function keyFor(tableName, keyOrItem = {}) {
  if (keyOrItem.pk) return `${tableName}|pk:${keyOrItem.pk}|sk:${keyOrItem.sk || ''}`;
  if (keyOrItem.ID) return `${tableName}|ID:${keyOrItem.ID}`;
  if (keyOrItem.asset_id) return `${tableName}|asset:${keyOrItem.asset_id}`;
  if (keyOrItem.commentId) return `${tableName}|comment:${keyOrItem.commentId}`;
  if (keyOrItem.token) return `${tableName}|token:${keyOrItem.token}`;
  return `${tableName}|${JSON.stringify(keyOrItem)}`;
}

function conditionalError(message = 'Conditional request failed') {
  const err = new Error(message);
  err.name = 'ConditionalCheckFailedException';
  return err;
}

function createMemoryDdb() {
  const store = new Map();

  function valuesForTable(tableName) {
    return Array.from(store.entries())
      .filter(([key]) => key.startsWith(`${tableName}|`))
      .map(([, value]) => clone(value));
  }

  function getByKey(tableName, key) {
    return store.get(keyFor(tableName, key)) || null;
  }

  function putItem(tableName, item, conditionExpression = '') {
    const key = keyFor(tableName, item);
    if (/attribute_not_exists/i.test(String(conditionExpression || '')) && store.has(key)) {
      throw conditionalError();
    }
    store.set(key, clone(item));
  }

  function deleteItem(tableName, key) {
    store.delete(keyFor(tableName, key));
  }

  function applySetExpression(current, input) {
    const names = input.ExpressionAttributeNames || {};
    const values = input.ExpressionAttributeValues || {};
    const expression = String(input.UpdateExpression || '');
    const setPart = expression.split(/\bADD\b/i)[0].replace(/^SET\s+/i, '');
    const matches = setPart.matchAll(/(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)/g);
    for (const match of matches) {
      const attr = names[match[1]] || match[1].slice(1);
      if (Object.prototype.hasOwnProperty.call(values, match[2])) {
        current[attr] = clone(values[match[2]]);
      }
    }
  }

  const ddb = {
    send: async (command) => {
      const input = command.input || {};
      const commandName = command.constructor?.name || '';
      const tableName = input.TableName || '';

      if (commandName === 'PutCommand') {
        putItem(tableName, input.Item, input.ConditionExpression);
        return {};
      }

      if (commandName === 'GetCommand') {
        return { Item: clone(getByKey(tableName, input.Key)) };
      }

      if (commandName === 'DeleteCommand') {
        deleteItem(tableName, input.Key);
        return {};
      }

      if (commandName === 'BatchWriteCommand') {
        for (const [batchTable, requests] of Object.entries(input.RequestItems || {})) {
          for (const request of requests || []) {
            if (request.PutRequest) putItem(batchTable, request.PutRequest.Item);
            if (request.DeleteRequest) deleteItem(batchTable, request.DeleteRequest.Key);
          }
        }
        return { UnprocessedItems: {} };
      }

      if (commandName === 'ScanCommand') {
        const items = valuesForTable(tableName);
        return { Items: input.Limit ? items.slice(0, input.Limit) : items };
      }

      if (commandName === 'QueryCommand') {
        const values = input.ExpressionAttributeValues || {};
        let items = valuesForTable(tableName);
        if (Object.prototype.hasOwnProperty.call(values, ':pk')) {
          items = items.filter((item) => item.pk === values[':pk']);
        }
        if (Object.prototype.hasOwnProperty.call(values, ':prefix')) {
          items = items.filter((item) => String(item.sk || '').startsWith(String(values[':prefix'] || '')));
        }
        if (Object.prototype.hasOwnProperty.call(values, ':lid')) {
          items = items.filter((item) => String(item.ListItemID || '') === String(values[':lid']));
        }
        if (Object.prototype.hasOwnProperty.call(values, ':pid')) {
          items = items.filter((item) => Number(item.PageID) === Number(values[':pid']));
        }
        if (Object.prototype.hasOwnProperty.call(values, ':pcid')) {
          items = items.filter((item) => Number(item.PageContentID) === Number(values[':pcid']));
        }
        if (Object.prototype.hasOwnProperty.call(values, ':gsi1pk')) {
          items = items.filter((item) => item.gsi1pk === values[':gsi1pk']);
        }
        if (Object.prototype.hasOwnProperty.call(values, ':gsi2pk')) {
          items = items.filter((item) => item.gsi2pk === values[':gsi2pk']);
        }
        if (Object.prototype.hasOwnProperty.call(values, ':postId')) {
          items = items.filter((item) => String(item.postId || '') === String(values[':postId'] || ''));
        }
        return { Items: input.Limit ? items.slice(0, input.Limit) : items };
      }

      if (commandName === 'UpdateCommand') {
        const key = keyFor(tableName, input.Key);
        const current = clone(store.get(key) || input.Key || {});
        const values = input.ExpressionAttributeValues || {};

        if (
          /#status\s*=\s*:expectedStatus/i.test(String(input.ConditionExpression || ''))
          && current.status !== values[':expectedStatus']
        ) {
          throw conditionalError('Status changed before conditional update');
        }

        if (Object.prototype.hasOwnProperty.call(values, ':one')) {
          const limit = Number(values[':limit'] || Number.MAX_SAFE_INTEGER);
          if (Number(current.count || 0) >= limit) throw conditionalError('Daily limit exceeded');
          current.count = Number(current.count || 0) + Number(values[':one']);
          current.expiresAtEpoch = values[':ttl'];
        }

        applySetExpression(current, input);
        store.set(key, current);
        return { Attributes: clone(current) };
      }

      throw new Error(`Unhandled fake DDB command: ${commandName}`);
    },
  };

  return {
    ddb,
    store,
    valuesForTable,
    getByKey,
  };
}

function clearPortfolioModuleCache() {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.includes('/redis-api-server/src/')) {
      delete require.cache[modulePath];
    }
  }
}

function installFakeAws(memory) {
  clearPortfolioModuleCache();
  const awsClients = require('../src/services/aws/clients');
  awsClients.getDdbDoc = () => memory.ddb;
  awsClients.getScheduler = () => ({
    send: async () => ({ ok: true }),
  });
  return awsClients;
}

function setMcpTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.MCP_CONTROL_TABLE_NAME = 'mcp-test-control';
  process.env.MCP_TOKEN_HASH_SECRET = 'test-mcp-token-hash-secret';
  process.env.CONTENT_TABLE_NAME = 'content-test';
  process.env.PREVIEW_SESSIONS_TABLE_NAME = 'preview-test';
  process.env.PHOTO_ASSETS_TABLE_NAME = 'photo-assets-test';
  process.env.SOCIAL_DISTRIBUTION_TABLE_NAME = 'social-distribution-test';
  process.env.SOCIAL_AUTH_TABLE_NAME = 'social-auth-test';
  process.env.PUBLIC_SITE_URL = 'https://www.example.test';
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
    server.on('error', reject);
  });
}

async function startMcpTestApp(memory) {
  installFakeAws(memory);
  const { createApp } = require('../src/app');
  const server = http.createServer(createApp());
  const address = await listen(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function callRegisteredTool(server, name, args = {}) {
  const tool = server._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  const parsed = await server.validateToolInput(tool, args, name);
  return server.executeToolHandler(tool, parsed, {});
}

module.exports = {
  callRegisteredTool,
  clearPortfolioModuleCache,
  createMemoryDdb,
  installFakeAws,
  setMcpTestEnv,
  startMcpTestApp,
};
