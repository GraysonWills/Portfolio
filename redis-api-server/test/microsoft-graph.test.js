const assert = require('node:assert/strict');
const test = require('node:test');

const socialAuth = require('../src/services/social-auth');
const microsoftGraph = require('../src/services/microsoft-graph');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function xlsxFixture(label = 'fixture') {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(label),
  ]);
}

test('OneDrive tracker download returns bytes with ETag and checksum', async (t) => {
  const originalFetch = global.fetch;
  const originalCredential = socialAuth.getPostingCredential;
  const previousDrive = process.env.JOB_TRACKER_DRIVE_ID;
  const previousItem = process.env.JOB_TRACKER_ITEM_ID;
  t.after(() => {
    global.fetch = originalFetch;
    socialAuth.getPostingCredential = originalCredential;
    if (previousDrive === undefined) delete process.env.JOB_TRACKER_DRIVE_ID;
    else process.env.JOB_TRACKER_DRIVE_ID = previousDrive;
    if (previousItem === undefined) delete process.env.JOB_TRACKER_ITEM_ID;
    else process.env.JOB_TRACKER_ITEM_ID = previousItem;
  });

  process.env.JOB_TRACKER_DRIVE_ID = 'drive-id';
  process.env.JOB_TRACKER_ITEM_ID = 'item-id';
  socialAuth.getPostingCredential = async () => ({
    scope: 'Files.ReadWrite',
    token: { access_token: 'microsoft-access-token' },
  });
  const workbook = xlsxFixture('downloaded');
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/content')) {
      return new Response(workbook, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
    }
    return jsonResponse({
      id: 'item-id',
      name: 'Copy of Job Search Organization Template.xlsx',
      size: workbook.length,
      eTag: '"etag-1"',
      cTag: '"ctag-1"',
      lastModifiedDateTime: '2026-07-24T12:00:00Z',
      file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    });
  };

  const result = await microsoftGraph.downloadTracker({ sub: 'owner' });
  assert.equal(result.workbook.eTag, '"etag-1"');
  assert.deepEqual(Buffer.from(result.workbook.dataBase64, 'base64'), workbook);
  assert.match(result.workbook.sha256, /^[a-f0-9]{64}$/);
  assert.equal(calls.length, 2);
});

test('OneDrive tracker replacement refuses stale ETags before upload', async (t) => {
  const originalFetch = global.fetch;
  const originalCredential = socialAuth.getPostingCredential;
  const previousDrive = process.env.JOB_TRACKER_DRIVE_ID;
  const previousItem = process.env.JOB_TRACKER_ITEM_ID;
  t.after(() => {
    global.fetch = originalFetch;
    socialAuth.getPostingCredential = originalCredential;
    if (previousDrive === undefined) delete process.env.JOB_TRACKER_DRIVE_ID;
    else process.env.JOB_TRACKER_DRIVE_ID = previousDrive;
    if (previousItem === undefined) delete process.env.JOB_TRACKER_ITEM_ID;
    else process.env.JOB_TRACKER_ITEM_ID = previousItem;
  });

  process.env.JOB_TRACKER_DRIVE_ID = 'drive-id';
  process.env.JOB_TRACKER_ITEM_ID = 'item-id';
  socialAuth.getPostingCredential = async () => ({
    scope: 'Files.ReadWrite',
    token: { access_token: 'microsoft-access-token' },
  });
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return jsonResponse({
      id: 'item-id',
      name: 'Copy of Job Search Organization Template.xlsx',
      size: 100,
      eTag: '"new-etag"',
      file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    });
  };

  await assert.rejects(() => microsoftGraph.replaceTracker({ sub: 'owner' }, {
    expectedETag: '"old-etag"',
    dataBase64: xlsxFixture('stale').toString('base64'),
  }), /changed after it was read/);
  assert.equal(calls, 1);
});

test('OneDrive tracker replacement uses an If-Match upload session', async (t) => {
  const originalFetch = global.fetch;
  const originalCredential = socialAuth.getPostingCredential;
  const previousDrive = process.env.JOB_TRACKER_DRIVE_ID;
  const previousItem = process.env.JOB_TRACKER_ITEM_ID;
  t.after(() => {
    global.fetch = originalFetch;
    socialAuth.getPostingCredential = originalCredential;
    if (previousDrive === undefined) delete process.env.JOB_TRACKER_DRIVE_ID;
    else process.env.JOB_TRACKER_DRIVE_ID = previousDrive;
    if (previousItem === undefined) delete process.env.JOB_TRACKER_ITEM_ID;
    else process.env.JOB_TRACKER_ITEM_ID = previousItem;
  });

  process.env.JOB_TRACKER_DRIVE_ID = 'drive-id';
  process.env.JOB_TRACKER_ITEM_ID = 'item-id';
  socialAuth.getPostingCredential = async () => ({
    scope: 'Files.ReadWrite',
    token: { access_token: 'microsoft-access-token' },
  });
  const workbook = xlsxFixture('updated');
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/createUploadSession')) {
      assert.equal(options.headers['If-Match'], '"etag-1"');
      return jsonResponse({ uploadUrl: 'https://upload.example.test/session' });
    }
    if (String(url) === 'https://upload.example.test/session') {
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers['Content-Range'], `bytes 0-${workbook.length - 1}/${workbook.length}`);
      assert.deepEqual(Buffer.from(options.body), workbook);
      return jsonResponse({
        id: 'item-id',
        name: 'Copy of Job Search Organization Template.xlsx',
        size: workbook.length,
        eTag: '"etag-2"',
        file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      }, 201);
    }
    return jsonResponse({
      id: 'item-id',
      name: 'Copy of Job Search Organization Template.xlsx',
      size: workbook.length,
      eTag: '"etag-1"',
      file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    });
  };

  const result = await microsoftGraph.replaceTracker({ sub: 'owner' }, {
    expectedETag: '"etag-1"',
    dataBase64: workbook.toString('base64'),
  });
  assert.equal(result.workbook.eTag, '"etag-2"');
  assert.equal(result.workbook.previousETag, '"etag-1"');
  assert.equal(calls.length, 3);
});

