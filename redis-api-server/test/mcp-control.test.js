const assert = require('node:assert/strict');
const test = require('node:test');

function loadMcpControlWithFakeDdb() {
  delete require.cache[require.resolve('../src/services/mcp-control')];
  const awsClients = require('../src/services/aws/clients');
  const store = new Map();
  const keyFor = (key) => `${key.pk}|${key.sk || ''}`;

  awsClients.getDdbDoc = () => ({
    send: async (command) => {
      const input = command.input || {};
      const commandName = command.constructor?.name || '';

      if (commandName === 'PutCommand') {
        store.set(keyFor(input.Item), { ...input.Item });
        return {};
      }

      if (commandName === 'GetCommand') {
        return { Item: store.get(keyFor(input.Key)) || null };
      }

      if (commandName === 'QueryCommand') {
        const pk = input.ExpressionAttributeValues?.[':pk'];
        const prefix = input.ExpressionAttributeValues?.[':prefix'] || '';
        const items = Array.from(store.values())
          .filter((item) => item.pk === pk)
          .filter((item) => !prefix || String(item.sk || '').startsWith(prefix));
        return { Items: items };
      }

      if (commandName === 'UpdateCommand') {
        const key = keyFor(input.Key);
        const current = store.get(key) || { ...input.Key };
        if (input.ExpressionAttributeValues?.[':lastUsedAt']) {
          current.lastUsedAt = input.ExpressionAttributeValues[':lastUsedAt'];
        }
        if (input.ExpressionAttributeValues?.[':status']) {
          current.status = input.ExpressionAttributeValues[':status'];
          current.updatedAt = input.ExpressionAttributeValues[':updatedAt'];
          current.revokedAt = input.ExpressionAttributeValues[':revokedAt'];
        }
        if (input.ExpressionAttributeValues?.[':one']) {
          current.count = Number(current.count || 0) + Number(input.ExpressionAttributeValues[':one']);
          current.expiresAtEpoch = input.ExpressionAttributeValues[':ttl'];
        }
        store.set(key, current);
        return { Attributes: current };
      }

      if (commandName === 'DeleteCommand') {
        store.delete(keyFor(input.Key));
        return {};
      }

      throw new Error(`Unhandled command in fake DDB: ${commandName}`);
    },
  });

  process.env.MCP_TOKEN_HASH_SECRET = 'test-secret-for-mcp-control-hashing-123';
  return {
    mcpControl: require('../src/services/mcp-control'),
    store,
  };
}

test('MCP clients return raw token once and store only token hashes', async () => {
  const { mcpControl, store } = loadMcpControlWithFakeDdb();
  const result = await mcpControl.createClient({
    name: 'Local agent',
    scopes: ['blog:read', 'not-real'],
  }, {
    sub: 'author-sub',
    email: 'author@example.com',
  });

  assert.match(result.token, /^mcp_/);
  assert.equal(result.client.name, 'Local agent');
  assert.deepEqual(result.client.scopes, ['blog:read']);

  const serializedStore = JSON.stringify(Array.from(store.values()));
  assert.equal(serializedStore.includes(result.token), false);
  assert.match(serializedStore, /tokenHash/);

  const authenticated = await mcpControl.authenticateBearer(`Bearer ${result.token}`);
  assert.equal(authenticated.clientId, result.client.clientId);
  assert.equal(authenticated.ownerSub, 'author-sub');
});

test('sanitizeBlogHtml strips scripts and unsafe attributes', () => {
  const { sanitizeBlogHtml } = require('../src/services/blog-posts');
  const clean = sanitizeBlogHtml('<p onclick="alert(1)">Hello</p><script>alert(2)</script><a href="javascript:alert(3)">bad</a>');

  assert.equal(clean.includes('script'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.match(clean, /Hello/);
});
