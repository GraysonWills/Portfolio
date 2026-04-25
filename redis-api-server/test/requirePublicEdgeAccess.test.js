const test = require('node:test');
const assert = require('node:assert/strict');

const middlewarePath = require.resolve('../src/middleware/requirePublicEdgeAccess');
const requireAuthPath = require.resolve('../src/middleware/requireAuth');

function loadMiddlewareWithAuthStub(stub = () => {}) {
  delete require.cache[middlewarePath];
  delete require.cache[requireAuthPath];

  require.cache[requireAuthPath] = {
    id: requireAuthPath,
    filename: requireAuthPath,
    loaded: true,
    exports: stub
  };

  const middleware = require(middlewarePath);
  return {
    middleware,
    restore() {
      delete require.cache[middlewarePath];
      delete require.cache[requireAuthPath];
    }
  };
}

function createResRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('allows preview session fetches through the public edge secret gate', () => {
  const previousSecret = process.env.PUBLIC_EDGE_SHARED_SECRET;
  process.env.PUBLIC_EDGE_SHARED_SECRET = 'preview-secret';

  let authCalls = 0;
  const { middleware, restore } = loadMiddlewareWithAuthStub(() => {
    authCalls += 1;
  });

  const req = {
    method: 'GET',
    baseUrl: '/api/content',
    path: '/preview/abc123',
    headers: {
      'x-portfolio-edge-secret': 'preview-secret'
    }
  };
  const res = createResRecorder();
  let nextCalls = 0;

  try {
    middleware(req, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 1);
    assert.equal(authCalls, 0);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, undefined);
  } finally {
    restore();
    if (typeof previousSecret === 'undefined') {
      delete process.env.PUBLIC_EDGE_SHARED_SECRET;
    } else {
      process.env.PUBLIC_EDGE_SHARED_SECRET = previousSecret;
    }
  }
});

test('allows preview session fetches when only originalUrl carries the full route', () => {
  const previousSecret = process.env.PUBLIC_EDGE_SHARED_SECRET;
  process.env.PUBLIC_EDGE_SHARED_SECRET = 'preview-secret';

  let authCalls = 0;
  const { middleware, restore } = loadMiddlewareWithAuthStub(() => {
    authCalls += 1;
  });

  const req = {
    method: 'GET',
    baseUrl: '/api/content',
    path: '/',
    originalUrl: '/api/content/preview/abc123',
    headers: {
      'x-portfolio-edge-secret': 'preview-secret'
    }
  };
  const res = createResRecorder();
  let nextCalls = 0;

  try {
    middleware(req, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 1);
    assert.equal(authCalls, 0);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, undefined);
  } finally {
    restore();
    if (typeof previousSecret === 'undefined') {
      delete process.env.PUBLIC_EDGE_SHARED_SECRET;
    } else {
      process.env.PUBLIC_EDGE_SHARED_SECRET = previousSecret;
    }
  }
});

test('still blocks non-allowlisted routes for edge-secret-only access', () => {
  const previousSecret = process.env.PUBLIC_EDGE_SHARED_SECRET;
  process.env.PUBLIC_EDGE_SHARED_SECRET = 'preview-secret';

  let authCalls = 0;
  const { middleware, restore } = loadMiddlewareWithAuthStub(() => {
    authCalls += 1;
  });

  const req = {
    method: 'GET',
    baseUrl: '/api/content',
    path: '/admin/dashboard',
    headers: {
      'x-portfolio-edge-secret': 'preview-secret'
    }
  };
  const res = createResRecorder();
  let nextCalls = 0;

  try {
    middleware(req, res, () => {
      nextCalls += 1;
    });

    assert.equal(nextCalls, 0);
    assert.equal(authCalls, 0);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  } finally {
    restore();
    if (typeof previousSecret === 'undefined') {
      delete process.env.PUBLIC_EDGE_SHARED_SECRET;
    } else {
      process.env.PUBLIC_EDGE_SHARED_SECRET = previousSecret;
    }
  }
});
