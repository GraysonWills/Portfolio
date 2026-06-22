const assert = require('node:assert/strict');
const test = require('node:test');

const {
  callRegisteredTool,
  clearPortfolioModuleCache,
  createMemoryDdb,
  installFakeAws,
  setMcpTestEnv,
  startMcpTestApp,
} = require('./mcp-test-utils');

function loadMcpModules(memory) {
  setMcpTestEnv();
  installFakeAws(memory);
  const mcpControl = require('../src/services/mcp-control');
  const { buildMcpServer, executeApproval } = require('../src/services/mcp-tools');
  const blogPosts = require('../src/services/blog-posts');
  return { mcpControl, buildMcpServer, executeApproval, blogPosts };
}

function testClient(scopes, limits = {}) {
  return {
    clientId: 'client-a',
    name: 'Client A',
    ownerSub: 'author-sub',
    scopes,
    limits: {
      read: limits.read || 100,
      draftMutation: limits.draftMutation || 100,
      approvalMutation: limits.approvalMutation || 100,
    },
  };
}

function contentItems(memory) {
  return memory.valuesForTable('content-test');
}

function hasSchemaField(tool, field) {
  const shape = typeof tool.inputSchema?.shape === 'object'
    ? tool.inputSchema.shape
    : tool.inputSchema?.def?.shape || {};
  return Boolean(shape[field]);
}

async function putMemoryItem(memory, tableName, item) {
  await memory.ddb.send({
    constructor: { name: 'PutCommand' },
    input: {
      TableName: tableName,
      Item: item,
    },
  });
}

async function seedContentRecord(memory, patch = {}) {
  const item = {
    ID: 'mcp-smoke-content-record',
    PageID: 1,
    PageContentID: 1,
    ListItemID: 'mcp-smoke-content',
    Text: 'Original content',
    Metadata: {},
    CreatedAt: '2026-01-01T00:00:00.000Z',
    UpdatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
  await putMemoryItem(memory, 'content-test', item);
  return item;
}

async function seedPhotoAsset(memory, patch = {}) {
  const asset = {
    asset_id: 'asset-mcp-smoke',
    owner: 'author-sub',
    status: 'ready',
    public_url: 'https://cdn.example.test/asset.jpg',
    content_type: 'image/jpeg',
    usage: 'blog',
    gsi1pk: 'ASSET',
    gsi1sk: '2026-01-01T00:00:00.000Z#asset-mcp-smoke',
    gsi2pk: 'OWNER#author-sub',
    gsi2sk: '2026-01-01T00:00:00.000Z#asset-mcp-smoke',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
  await putMemoryItem(memory, 'photo-assets-test', asset);
  return asset;
}

async function seedComment(memory, patch = {}) {
  const comment = {
    commentId: 'comment-mcp-smoke',
    postId: 'mcp-smoke-post',
    body: 'A seeded comment',
    authorSub: 'reader-sub',
    authorName: 'Reader',
    authorRole: 'reader',
    status: 'visible',
    likeCount: 0,
    replyCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
  await putMemoryItem(memory, 'portfolio-blog-comments', comment);
  return comment;
}

async function seedSocialDelivery(memory, patch = {}) {
  const delivery = {
    pk: 'USER#author-sub',
    sk: 'DELIVERY#delivery-mcp-smoke',
    type: 'social_delivery',
    deliveryId: 'delivery-mcp-smoke',
    userSub: 'author-sub',
    provider: 'x',
    caption: 'Seeded social delivery',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
  await putMemoryItem(memory, 'social-distribution-test', delivery);
  return delivery;
}

function controlItems(memory, type = '') {
  const items = memory.valuesForTable('mcp-test-control');
  return type ? items.filter((item) => item.type === type) : items;
}

async function mcpRpc(baseUrl, token, body, headers = {}) {
  const res = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

test('MCP tool registry exposes draft delete and idempotency-capable mutation schemas', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer } = loadMcpModules(memory);
  const server = buildMcpServer(testClient(mcpControl.ALL_SCOPES));

  assert.ok(server._registeredTools['blog.delete_mcp_draft']);
  assert.ok(hasSchemaField(server._registeredTools['blog.create_draft'], 'idempotencyKey'));
  assert.ok(hasSchemaField(server._registeredTools['blog.propose_update'], 'idempotencyKey'));
  assert.ok(hasSchemaField(server._registeredTools['content.propose_update'], 'route'));
});

test('MCP draft create, update, and delete are restricted to the owning client', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer, blogPosts } = loadMcpModules(memory);
  const server = buildMcpServer(testClient(mcpControl.ALL_SCOPES));

  const created = await callRegisteredTool(server, 'blog.create_draft', {
    listItemID: 'mcp-smoke-owned-draft',
    title: 'Owned Draft',
    contentMarkdown: 'Hello from MCP.',
    idempotencyKey: 'owned-create',
  });
  assert.equal(created.structuredContent.post.status, 'draft');
  assert.equal(created.structuredContent.post.source.clientId, 'client-a');

  const updated = await callRegisteredTool(server, 'blog.update_mcp_draft', {
    listItemID: 'mcp-smoke-owned-draft',
    summary: 'Updated summary',
    expectedVersion: created.structuredContent.post.version,
    idempotencyKey: 'owned-update',
  });
  assert.equal(updated.structuredContent.post.summary, 'Updated summary');
  assert.equal(updated.structuredContent.post.version, created.structuredContent.post.version + 1);

  const deleted = await callRegisteredTool(server, 'blog.delete_mcp_draft', {
    listItemID: 'mcp-smoke-owned-draft',
    expectedVersion: updated.structuredContent.post.version,
    idempotencyKey: 'owned-delete',
  });
  assert.equal(deleted.structuredContent.ok, true);
  assert.equal(contentItems(memory).filter((item) => item.ListItemID === 'mcp-smoke-owned-draft').length, 0);

  await blogPosts.createPost({
    listItemID: 'mcp-smoke-other-draft',
    title: 'Other Draft',
    contentMarkdown: 'Created by another client.',
  }, {
    actor: { clientId: 'client-b', clientName: 'Client B', sub: 'author-sub' },
    source: 'mcp',
    draftOnly: true,
  });

  await assert.rejects(
    () => callRegisteredTool(server, 'blog.delete_mcp_draft', {
      listItemID: 'mcp-smoke-other-draft',
    }),
    /MCP clients may only directly update drafts they created/
  );
});

test('MCP mutation idempotency replays same response and rejects changed payloads', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer } = loadMcpModules(memory);
  const server = buildMcpServer(testClient(mcpControl.ALL_SCOPES));
  const request = {
    title: 'Idempotent Draft',
    contentMarkdown: 'Only one content bundle should be written.',
    idempotencyKey: 'same-draft-create',
  };

  const first = await callRegisteredTool(server, 'blog.create_draft', request);
  const second = await callRegisteredTool(server, 'blog.create_draft', request);

  assert.equal(second.structuredContent.post.listItemID, first.structuredContent.post.listItemID);
  assert.equal(contentItems(memory).filter((item) => item.ListItemID === first.structuredContent.post.listItemID).length, 3);

  await assert.rejects(
    () => callRegisteredTool(server, 'blog.create_draft', {
      ...request,
      title: 'Changed Payload',
    }),
    /Idempotency-Key was reused with a different payload/
  );
});

test('MCP scopes and daily mutation limits are enforced before tool handlers run', async () => {
  const memory = createMemoryDdb();
  const { buildMcpServer } = loadMcpModules(memory);

  const readOnlyServer = buildMcpServer(testClient(['blog:read']));
  await assert.rejects(
    () => callRegisteredTool(readOnlyServer, 'blog.create_draft', {
      title: 'Denied',
      contentMarkdown: 'No scope.',
    }),
    /missing scope: blog:write:draft/
  );

  const limitedServer = buildMcpServer(testClient(['blog:write:draft'], { draftMutation: 1 }));
  await callRegisteredTool(limitedServer, 'blog.create_draft', {
    title: 'Allowed once',
    contentMarkdown: 'First write.',
  });
  await assert.rejects(
    () => callRegisteredTool(limitedServer, 'blog.create_draft', {
      title: 'Denied twice',
      contentMarkdown: 'Second write.',
    }),
    /daily limit exceeded/
  );
});

test('MCP read and draft tools cover blog, content, media, comments, social, and previews', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer, blogPosts } = loadMcpModules(memory);
  const server = buildMcpServer(testClient(mcpControl.ALL_SCOPES));

  const post = await blogPosts.createPost({
    listItemID: 'mcp-smoke-post',
    title: 'Tool Coverage Post',
    contentMarkdown: 'Tool coverage body.',
  }, {
    actor: { sub: 'author-sub' },
    source: 'authoring',
  });
  const content = await seedContentRecord(memory);
  const asset = await seedPhotoAsset(memory);
  const comment = await seedComment(memory);
  const delivery = await seedSocialDelivery(memory);

  const inventory = await callRegisteredTool(server, 'site.get_inventory');
  assert.equal(inventory.structuredContent.api.ok, true);

  const listedContent = await callRegisteredTool(server, 'content.list', { pageId: 1 });
  assert.equal(listedContent.structuredContent.items[0].ID, content.ID);

  const fetchedContent = await callRegisteredTool(server, 'content.get', { id: content.ID });
  assert.equal(fetchedContent.structuredContent.item.Text, content.Text);

  const listedPosts = await callRegisteredTool(server, 'blog.list_posts', { status: 'all', limit: 5 });
  assert.ok(listedPosts.structuredContent.items.some((item) => item.listItemID === post.listItemID));

  const fetchedPost = await callRegisteredTool(server, 'blog.get_post', { listItemID: post.listItemID });
  assert.equal(fetchedPost.structuredContent.post.title, post.title);

  const listedAssets = await callRegisteredTool(server, 'media.list_assets', { limit: 5 });
  assert.ok(listedAssets.structuredContent.items.some((item) => item.asset_id === asset.asset_id));

  const recentComments = await callRegisteredTool(server, 'comments.list_recent', { limit: 5 });
  assert.ok(recentComments.structuredContent.comments.some((item) => item.commentId === comment.commentId));

  const thread = await callRegisteredTool(server, 'comments.get_thread', { postId: comment.postId });
  assert.equal(thread.structuredContent.comments[0].commentId, comment.commentId);

  const socialStatus = await callRegisteredTool(server, 'social.get_status');
  assert.ok(Array.isArray(socialStatus.structuredContent.providers));

  const deliveries = await callRegisteredTool(server, 'social.list_deliveries', { limit: 5 });
  assert.ok(deliveries.structuredContent.deliveries.some((item) => item.deliveryId === delivery.deliveryId));

  const preview = await callRegisteredTool(server, 'preview.create', {
    route: '/work',
    upserts: [{ ...content, Text: 'Preview content' }],
    idempotencyKey: 'preview-create',
  });
  assert.match(preview.structuredContent.previewUrl, /\/work\?previewToken=/);

  const socialDraft = await callRegisteredTool(server, 'social.create_delivery_draft', {
    provider: 'x',
    caption: 'Draft social post',
    idempotencyKey: 'social-draft-create',
  });
  assert.equal(socialDraft.structuredContent.delivery.status, 'draft');
});

test('MCP remote image upload rejects unsupported content before storage', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer } = loadMcpModules(memory);
  process.env.PHOTO_ASSETS_BUCKET = 'photo-assets-bucket';
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-type') return 'text/plain';
        if (String(name).toLowerCase() === 'content-length') return '12';
        return '';
      },
    },
    arrayBuffer: async () => Buffer.from('not an image'),
  });

  try {
    const server = buildMcpServer(testClient(mcpControl.ALL_SCOPES));
    await assert.rejects(
      () => callRegisteredTool(server, 'media.upload_image_from_url', {
        url: 'https://example.test/not-image.txt',
        idempotencyKey: 'bad-image-upload',
      }),
      /Unsupported remote image type/
    );
  } finally {
    global.fetch = originalFetch;
    delete process.env.PHOTO_ASSETS_BUCKET;
  }
});

test('MCP approval previews include proposed blog/content changes', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer, blogPosts } = loadMcpModules(memory);
  const server = buildMcpServer(testClient(mcpControl.ALL_SCOPES));

  await blogPosts.createPost({
    listItemID: 'mcp-smoke-preview-post',
    title: 'Preview Original',
    contentMarkdown: 'Original body.',
  }, {
    actor: { sub: 'author-sub' },
    source: 'authoring',
  });

  const blogApproval = await callRegisteredTool(server, 'blog.propose_update', {
    listItemID: 'mcp-smoke-preview-post',
    patch: {
      title: 'Preview Proposed',
      contentMarkdown: 'Proposed body.',
    },
    idempotencyKey: 'blog-preview-proposal',
  });

  assert.match(blogApproval.structuredContent.previewUrl, /previewToken=/);
  const blogPreview = memory.valuesForTable('preview-test')
    .find((item) => item.payload?.source === 'mcp-propose-update');
  assert.ok(blogPreview);
  assert.ok(blogPreview.payload.upserts.some((item) => item.Text === 'Preview Proposed'));
  assert.ok(blogPreview.payload.upserts.some((item) => String(item.Text || '').includes('Proposed body')));

  const contentId = 'mcp-smoke-content-record';
  memory.ddb.send({
    constructor: { name: 'PutCommand' },
    input: {
      TableName: 'content-test',
      Item: {
        ID: contentId,
        PageID: 1,
        PageContentID: 1,
        ListItemID: 'mcp-smoke-content',
        Text: 'Original content',
        Metadata: {},
      },
    },
  });

  const contentApproval = await callRegisteredTool(server, 'content.propose_update', {
    id: contentId,
    patch: { Text: 'Proposed content' },
    route: '/work',
    idempotencyKey: 'content-preview-proposal',
  });
  assert.match(contentApproval.structuredContent.previewUrl, /\/work\?previewToken=/);
  const contentPreview = memory.valuesForTable('preview-test')
    .find((item) => item.payload?.source === 'mcp-content-propose-update');
  assert.equal(contentPreview.payload.upserts[0].Text, 'Proposed content');
});

test('MCP approval tools cover blog, content, media, comment, and social review paths', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer, executeApproval } = loadMcpModules(memory);
  const server = buildMcpServer(testClient(mcpControl.ALL_SCOPES));
  const reviewer = { sub: 'author-sub', email: 'author@example.com' };

  await callRegisteredTool(server, 'blog.create_draft', {
    listItemID: 'mcp-smoke-approval-post',
    title: 'Approval Post',
    contentMarkdown: 'Approval body.',
    idempotencyKey: 'approval-post-create',
  });
  const content = await seedContentRecord(memory, { ID: 'mcp-smoke-approval-content' });
  const asset = await seedPhotoAsset(memory, { asset_id: 'asset-mcp-approval' });
  const comment = await seedComment(memory, { commentId: 'comment-mcp-approval' });
  const delivery = await seedSocialDelivery(memory, { deliveryId: 'delivery-mcp-approval', sk: 'DELIVERY#delivery-mcp-approval' });

  const proposal = await callRegisteredTool(server, 'blog.propose_update', {
    listItemID: 'mcp-smoke-approval-post',
    patch: { title: 'Approval Post Updated' },
    idempotencyKey: 'approval-blog-update',
  });
  const replay = await callRegisteredTool(server, 'blog.propose_update', {
    listItemID: 'mcp-smoke-approval-post',
    patch: { title: 'Approval Post Updated' },
    idempotencyKey: 'approval-blog-update',
  });
  assert.equal(replay.structuredContent.approvalId, proposal.structuredContent.approvalId);

  const approvalRequests = [
    proposal,
    await callRegisteredTool(server, 'blog.request_publish', {
      listItemID: 'mcp-smoke-approval-post',
      sendEmail: false,
      idempotencyKey: 'approval-publish',
    }),
    await callRegisteredTool(server, 'blog.request_schedule', {
      listItemID: 'mcp-smoke-approval-post',
      publishAt: '2026-07-01T12:00:00.000Z',
      sendEmail: false,
      idempotencyKey: 'approval-schedule',
    }),
    await callRegisteredTool(server, 'blog.request_unpublish', {
      listItemID: 'mcp-smoke-approval-post',
      idempotencyKey: 'approval-unpublish',
    }),
    await callRegisteredTool(server, 'blog.request_delete', {
      listItemID: 'mcp-smoke-approval-post',
      idempotencyKey: 'approval-delete',
    }),
    await callRegisteredTool(server, 'content.propose_update', {
      id: content.ID,
      patch: { Text: 'Approval content update' },
      route: '/projects',
      idempotencyKey: 'approval-content',
    }),
    await callRegisteredTool(server, 'media.request_delete', {
      assetId: asset.asset_id,
      idempotencyKey: 'approval-media-delete',
    }),
    await callRegisteredTool(server, 'comments.propose_reply', {
      commentId: comment.commentId,
      body: 'Thanks for the note.',
      idempotencyKey: 'approval-comment-reply',
    }),
    await callRegisteredTool(server, 'comments.request_delete', {
      commentId: comment.commentId,
      idempotencyKey: 'approval-comment-delete',
    }),
    await callRegisteredTool(server, 'social.propose_settings_update', {
      settings: { quietMode: true },
      idempotencyKey: 'approval-social-settings',
    }),
    await callRegisteredTool(server, 'social.request_send_delivery', {
      deliveryId: delivery.deliveryId,
      idempotencyKey: 'approval-social-send',
    }),
  ];

  const actions = new Set(controlItems(memory, 'mcp_approval').map((item) => item.action));
  for (const expected of [
    'blog.propose_update',
    'blog.request_publish',
    'blog.request_schedule',
    'blog.request_unpublish',
    'blog.request_delete',
    'content.propose_update',
    'media.request_delete',
    'comments.propose_reply',
    'comments.request_delete',
    'social.propose_settings_update',
    'social.request_send_delivery',
  ]) {
    assert.ok(actions.has(expected), `missing approval action ${expected}`);
  }

  const rejectTarget = approvalRequests.find((request) => request.structuredContent.approval.action === 'comments.request_delete');
  const rejected = await mcpControl.decideApproval({
    approvalId: rejectTarget.structuredContent.approvalId,
    decision: 'rejected',
    reviewerUser: reviewer,
    error: 'Not needed',
  });
  assert.equal(rejected.status, 'rejected');

  const executed = await executeApproval(proposal.structuredContent.approvalId, reviewer);
  assert.equal(executed.approval.status, 'executed');
  assert.equal(executed.result.title, 'Approval Post Updated');

  const failedApproval = await mcpControl.createApproval({
    client: testClient(mcpControl.ALL_SCOPES),
    action: 'blog.request_delete',
    payload: { listItemID: 'mcp-smoke-missing-post' },
    summary: 'Delete missing post',
    targetIds: ['mcp-smoke-missing-post'],
  });
  await assert.rejects(
    () => executeApproval(failedApproval.approvalId, reviewer),
    /Blog post not found/
  );
  assert.equal((await mcpControl.getApproval(failedApproval.approvalId)).status, 'failed');

  const expiredApproval = await mcpControl.createApproval({
    client: testClient(mcpControl.ALL_SCOPES),
    action: 'social.propose_settings_update',
    payload: { settings: { quietMode: true } },
    summary: 'Expired approval',
  });
  const rawExpired = memory.getByKey('mcp-test-control', {
    pk: 'MCP#APPROVALS',
    sk: `APPROVAL#${expiredApproval.approvalId}`,
  });
  await putMemoryItem(memory, 'mcp-test-control', {
    ...rawExpired,
    expiresAtEpoch: 1,
  });
  await assert.rejects(
    () => executeApproval(expiredApproval.approvalId, reviewer),
    /Approval has expired/
  );
  assert.equal((await mcpControl.getApproval(expiredApproval.approvalId)).status, 'pending');
});

test('MCP auto-executes approval actions only when the client allowlist includes the action', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer, blogPosts } = loadMcpModules(memory);
  const manualServer = buildMcpServer(testClient(mcpControl.ALL_SCOPES));
  const autoServer = buildMcpServer({
    ...testClient(mcpControl.ALL_SCOPES),
    autoExecuteActions: ['blog.propose_update'],
  });

  await blogPosts.createPost({
    listItemID: 'mcp-smoke-auto-post',
    title: 'Auto Original',
    contentMarkdown: 'Original body.',
  }, {
    actor: { sub: 'author-sub' },
    source: 'authoring',
  });

  const pending = await callRegisteredTool(manualServer, 'blog.propose_update', {
    listItemID: 'mcp-smoke-auto-post',
    patch: { summary: 'Manual pending summary' },
    idempotencyKey: 'manual-auto-check',
  });
  assert.equal(pending.structuredContent.autoExecuted, false);
  assert.equal(pending.structuredContent.approval.status, 'pending');

  const executed = await callRegisteredTool(autoServer, 'blog.propose_update', {
    listItemID: 'mcp-smoke-auto-post',
    patch: { title: 'Auto Executed' },
    idempotencyKey: 'auto-execute-check',
  });
  assert.equal(executed.structuredContent.autoExecuted, true);
  assert.equal(executed.structuredContent.approval.status, 'executed');
  assert.equal(executed.structuredContent.result.title, 'Auto Executed');

  const updated = await blogPosts.getPost('mcp-smoke-auto-post');
  assert.equal(updated.title, 'Auto Executed');

  const approvals = controlItems(memory, 'mcp_approval')
    .filter((item) => item.action === 'blog.propose_update');
  assert.ok(approvals.some((item) => item.status === 'pending'));
  assert.ok(approvals.some((item) => item.status === 'executed'));
});

test('MCP audit records are written for success, failure, and idempotent replay', async () => {
  const memory = createMemoryDdb();
  const { mcpControl, buildMcpServer } = loadMcpModules(memory);
  const server = buildMcpServer(testClient(mcpControl.ALL_SCOPES));

  const request = {
    title: 'Audited Draft',
    contentMarkdown: 'Audit me.',
    idempotencyKey: 'audited-create',
  };
  await callRegisteredTool(server, 'blog.create_draft', request);
  await callRegisteredTool(server, 'blog.create_draft', request);
  await assert.rejects(
    () => callRegisteredTool(server, 'content.get', { id: 'missing-content' }),
    /Content record not found/
  );
  await callRegisteredTool(server, 'blog.list_posts', { status: 'all', limit: 1 });

  const statuses = controlItems(memory, 'mcp_audit').map((item) => item.resultStatus);
  assert.ok(statuses.includes('ok'));
  assert.ok(statuses.includes('idempotent_replay'));
  assert.ok(statuses.includes('failed'));
});

test('MCP HTTP route rejects missing and invalid bearer tokens', async (t) => {
  const memory = createMemoryDdb();
  setMcpTestEnv();
  const { server, baseUrl } = await startMcpTestApp(memory);
  t.after(() => {
    server.close();
    clearPortfolioModuleCache();
  });

  const missing = await mcpRpc(baseUrl, '', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert.equal(missing.res.status, 401);
  assert.equal(missing.json.error, 'Missing MCP bearer token');

  const invalid = await mcpRpc(baseUrl, 'mcp_not-real', {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  assert.equal(invalid.res.status, 401);
  assert.equal(invalid.json.error, 'Invalid MCP bearer token');

  const malformed = await mcpRpc(baseUrl, '', {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
  }, {
    authorization: 'Token mcp_not-bearer',
  });
  assert.equal(malformed.res.status, 401);
});

test('MCP HTTP route rejects revoked and expired bearer tokens', async (t) => {
  const memory = createMemoryDdb();
  setMcpTestEnv();
  const { server, baseUrl } = await startMcpTestApp(memory);
  const mcpControl = require('../src/services/mcp-control');
  const revoked = await mcpControl.createClient({
    name: 'Revoked protocol test client',
    scopes: ['site:read', 'blog:read'],
  }, {
    sub: 'author-sub',
    email: 'author@example.com',
  });
  await mcpControl.revokeClient(revoked.client.clientId, { sub: 'author-sub' });

  const expired = await mcpControl.createClient({
    name: 'Expired protocol test client',
    scopes: ['site:read', 'blog:read'],
    expiresAt: '2099-01-01T00:00:00.000Z',
  }, {
    sub: 'author-sub',
    email: 'author@example.com',
  });
  const rawExpired = memory.getByKey('mcp-test-control', {
    pk: 'MCP#CLIENTS',
    sk: `CLIENT#${expired.client.clientId}`,
  });
  await putMemoryItem(memory, 'mcp-test-control', {
    ...rawExpired,
    expiresAtEpoch: 1,
  });

  t.after(() => {
    server.close();
    clearPortfolioModuleCache();
  });

  const revokedResp = await mcpRpc(baseUrl, revoked.token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert.equal(revokedResp.res.status, 401);
  assert.equal(revokedResp.json.error, 'Invalid MCP bearer token');

  const expiredResp = await mcpRpc(baseUrl, expired.token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  assert.equal(expiredResp.res.status, 401);
  assert.equal(expiredResp.json.error, 'MCP client token is expired');
});

test('MCP HTTP route accepts initialize, tools/list, and tools/call with normalized headers', async (t) => {
  const memory = createMemoryDdb();
  setMcpTestEnv();
  const { server, baseUrl } = await startMcpTestApp(memory);
  const mcpControl = require('../src/services/mcp-control');
  const created = await mcpControl.createClient({
    name: 'Protocol test client',
    scopes: ['site:read', 'blog:read'],
  }, {
    sub: 'author-sub',
    email: 'author@example.com',
  });

  t.after(() => {
    server.close();
    clearPortfolioModuleCache();
  });

  const init = await mcpRpc(baseUrl, created.token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'node-test', version: '1.0.0' },
    },
  }, {
    accept: '*/*',
  });

  assert.equal(init.res.status, 200);
  assert.equal(init.json.result.serverInfo.name, 'portfolio-blog-authoring');

  const list = await mcpRpc(baseUrl, created.token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  }, {
    accept: 'application/json',
  });
  assert.equal(list.res.status, 200);
  assert.ok(list.json.result.tools.some((tool) => tool.name === 'blog.list_posts'));

  const call = await mcpRpc(baseUrl, created.token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'blog.list_posts',
      arguments: { status: 'all', limit: 1 },
    },
  });
  assert.equal(call.res.status, 200);
  assert.ok(call.json.result.structuredContent.items);

  const invalid = await mcpRpc(baseUrl, created.token, {
    id: 4,
    method: 'tools/list',
  });
  assert.ok(invalid.res.status >= 400 || invalid.json?.error);
});
