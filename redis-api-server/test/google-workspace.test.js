const assert = require('node:assert/strict');
const test = require('node:test');

const socialAuth = require('../src/services/social-auth');
const googleWorkspace = require('../src/services/google-workspace');

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(`${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`, 'base64').toString('utf8');
}

test('Gmail MIME builder validates recipients and blocks header injection', () => {
  assert.throws(() => googleWorkspace.buildMimeMessage({
    to: ['manager@example.com\r\nBcc: attacker@example.com'],
    subject: 'Hello',
    bodyText: 'Body',
  }), /invalid control characters/);

  assert.throws(() => googleWorkspace.buildMimeMessage({
    to: ['not-an-email'],
    subject: 'Hello',
    bodyText: 'Body',
  }), /valid email address/);
});

test('Gmail MIME builder creates a plain-text message with a resume attachment', () => {
  const mime = googleWorkspace.buildMimeMessage({
    to: ['Hiring Manager <manager@example.com>'],
    subject: 'AI engineering at Example',
    bodyText: 'Hi there,\n\nI would welcome a conversation.\n',
    attachments: [{
      filename: 'Grayson_Wills_Resume.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      dataBase64: Buffer.from('resume-bytes').toString('base64'),
    }],
  });

  assert.match(mime, /^To: Hiring Manager <manager@example\.com>/);
  assert.match(mime, /Subject: AI engineering at Example/);
  assert.match(mime, /Content-Type: multipart\/mixed/);
  assert.match(mime, /filename="Grayson_Wills_Resume\.docx"/);
  assert.match(mime, new RegExp(Buffer.from('resume-bytes').toString('base64')));
});

test('Gmail message summarization returns bounded text and attachment metadata', () => {
  const message = googleWorkspace.summarizeMessage({
    id: 'gmail-message-id',
    threadId: 'gmail-thread-id',
    internalDate: '1767225600000',
    labelIds: ['SENT'],
    snippet: 'Hi there',
    payload: {
      headers: [
        { name: 'Subject', value: 'Resume | ML Engineer' },
        { name: 'To', value: 'manager@example.com' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: googleWorkspace.toBase64Url('Hello from Grayson.') },
        },
        {
          mimeType: 'application/pdf',
          filename: 'resume.pdf',
          body: { attachmentId: 'attachment-id', size: 1234 },
        },
      ],
    },
  }, true);

  assert.equal(message.subject, 'Resume | ML Engineer');
  assert.equal(message.bodyText, 'Hello from Grayson.');
  assert.deepEqual(message.attachments, [{
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    size: 1234,
    attachmentId: 'attachment-id',
  }]);
});

test('Gmail draft creation calls drafts endpoint and never a send endpoint', async (t) => {
  const originalFetch = global.fetch;
  const originalCredential = socialAuth.getPostingCredential;
  const calls = [];
  t.after(() => {
    global.fetch = originalFetch;
    socialAuth.getPostingCredential = originalCredential;
  });

  socialAuth.getPostingCredential = async () => ({
    scope: 'https://www.googleapis.com/auth/gmail.compose',
    token: { access_token: 'google-access-token' },
  });
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      id: 'draft-id',
      message: { id: 'message-id', threadId: 'thread-id' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await googleWorkspace.createDraft({ sub: 'owner' }, {
    to: ['manager@example.com'],
    subject: 'Hello',
    bodyText: 'A short note.',
  });

  assert.equal(result.draft.status, 'draft');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts');
  assert.equal(calls[0].options.method, 'POST');
  assert.doesNotMatch(calls[0].url, /send/);
  const request = JSON.parse(calls[0].options.body);
  assert.match(decodeBase64Url(request.message.raw), /Subject: Hello/);
});

test('Gmail draft creation recovers by deterministic Message-ID after a lost response', async (t) => {
  const originalFetch = global.fetch;
  const originalCredential = socialAuth.getPostingCredential;
  const calls = [];
  t.after(() => {
    global.fetch = originalFetch;
    socialAuth.getPostingCredential = originalCredential;
  });
  socialAuth.getPostingCredential = async () => ({
    scope: 'https://www.googleapis.com/auth/gmail.compose',
    token: { access_token: 'google-access-token' },
  });
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('?')) {
      return new Response(JSON.stringify({
        drafts: [{
          id: 'existing-draft-id',
          message: { id: 'existing-message-id', threadId: 'existing-thread-id' },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('POST must not execute when the draft already exists');
  };

  const result = await googleWorkspace.createDraft({ sub: 'owner' }, {
    to: ['manager@example.com'],
    subject: 'Hello',
    bodyText: 'A short note.',
    idempotencyKey: 'stable-job-outreach-effect',
  });

  assert.equal(result.draft.id, 'existing-draft-id');
  assert.equal(result.draft.idempotentReplay, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/drafts\?q=rfc822msgid/);
  assert.doesNotMatch(calls[0].url, /send/);
});

test('Gmail MIME includes deterministic Message-ID when idempotency is supplied', () => {
  const first = googleWorkspace.buildMimeMessage({
    to: ['manager@example.com'],
    subject: 'Hello',
    bodyText: 'Body',
    idempotencyKey: 'same-effect',
  });
  const second = googleWorkspace.buildMimeMessage({
    to: ['manager@example.com'],
    subject: 'Edited subject',
    bodyText: 'Edited body',
    idempotencyKey: 'same-effect',
  });
  const messageId = first.match(/^Message-ID: (.+)$/m)?.[1];
  assert.ok(messageId);
  assert.match(messageId, /^<job-outreach-[a-f0-9]{64}@drafts\.local>$/);
  assert.equal(second.match(/^Message-ID: (.+)$/m)?.[1], messageId);
});
