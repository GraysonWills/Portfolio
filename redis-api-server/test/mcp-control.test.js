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

test('blog post lookup falls back to deterministic IDs when the list index is stale', async () => {
  const contentDdbPath = require.resolve('../src/services/content-ddb');
  const blogPostsPath = require.resolve('../src/services/blog-posts');
  const originalContentDdb = require.cache[contentDdbPath];

  const listItemID = 'mcp-codex-smoke-index-lag';
  const recordsById = new Map([
    ['blog-item-mcp-codex-smoke-index-lag', {
      ID: 'blog-item-mcp-codex-smoke-index-lag',
      PageID: 3,
      PageContentID: 3,
      ListItemID: listItemID,
      Text: 'Index Lag Draft',
      Metadata: {
        title: 'Index Lag Draft',
        status: 'draft',
        version: 1,
        mcpSource: { type: 'mcp', clientId: 'client-1' },
      },
      CreatedAt: '2026-06-15T00:00:00.000Z',
      UpdatedAt: '2026-06-15T00:00:00.000Z',
    }],
    ['blog-text-mcp-codex-smoke-index-lag', {
      ID: 'blog-text-mcp-codex-smoke-index-lag',
      PageID: 3,
      PageContentID: 4,
      ListItemID: listItemID,
      Text: '<p>Hello from a deterministic fallback.</p>',
      Metadata: {},
      CreatedAt: '2026-06-15T00:00:00.000Z',
      UpdatedAt: '2026-06-15T00:00:00.000Z',
    }],
    ['blog-body-mcp-codex-smoke-index-lag', {
      ID: 'blog-body-mcp-codex-smoke-index-lag',
      PageID: 3,
      PageContentID: 13,
      ListItemID: listItemID,
      Text: '<p>Hello from a deterministic fallback.</p>',
      Metadata: {},
      CreatedAt: '2026-06-15T00:00:00.000Z',
      UpdatedAt: '2026-06-15T00:00:00.000Z',
    }],
  ]);

  require.cache[contentDdbPath] = {
    id: contentDdbPath,
    filename: contentDdbPath,
    loaded: true,
    exports: {
      ddbBatchPutContent: async () => [],
      ddbDeleteContentById: async () => {},
      ddbDeleteContentByListItemId: async () => 0,
      ddbGetContentById: async (id) => recordsById.get(id) || null,
      ddbGetContentByListItemId: async () => [],
      ddbPutContent: async (item) => item,
      ddbScanAllContent: async () => [],
      isContentDdbEnabled: () => true,
    },
  };
  delete require.cache[blogPostsPath];

  try {
    const blogPosts = require('../src/services/blog-posts');
    const post = await blogPosts.getPost(listItemID, { includeItems: true });

    assert.equal(post.listItemID, listItemID);
    assert.equal(post.title, 'Index Lag Draft');
    assert.equal(post.status, 'draft');
    assert.equal(post.contentHtml, '<p>Hello from a deterministic fallback.</p>');
    assert.equal(post.items.length, 3);
  } finally {
    delete require.cache[blogPostsPath];
    if (originalContentDdb) {
      require.cache[contentDdbPath] = originalContentDdb;
    } else {
      delete require.cache[contentDdbPath];
    }
  }
});
