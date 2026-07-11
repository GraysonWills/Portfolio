const test = require('node:test');
const assert = require('node:assert/strict');

const subscriptionsPath = require.resolve('../src/services/subscriptions');
const awsClientsPath = require.resolve('../src/services/aws/clients');
const emailTemplatesPath = require.resolve('../src/services/email/templates');

function loadSubscriptionsWithStubs({ ddbSend, sesSend }) {
  const previousEnv = {
    SES_FROM_EMAIL: process.env.SES_FROM_EMAIL,
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
    SUBSCRIBE_PENDING_RESEND_COOLDOWN_MS: process.env.SUBSCRIBE_PENDING_RESEND_COOLDOWN_MS
  };

  process.env.SES_FROM_EMAIL = 'noreply@example.com';
  process.env.PUBLIC_SITE_URL = 'https://www.grayson-wills.com';
  process.env.SUBSCRIBE_PENDING_RESEND_COOLDOWN_MS = '60000';

  delete require.cache[subscriptionsPath];
  delete require.cache[awsClientsPath];
  delete require.cache[emailTemplatesPath];

  require.cache[awsClientsPath] = {
    id: awsClientsPath,
    filename: awsClientsPath,
    loaded: true,
    exports: {
      getDdbDoc: () => ({ send: ddbSend }),
      getSes: () => ({ send: sesSend || (async () => ({ MessageId: 'mock-message' })) })
    }
  };

  require.cache[emailTemplatesPath] = {
    id: emailTemplatesPath,
    filename: emailTemplatesPath,
    loaded: true,
    exports: {
      buildConfirmEmail: () => ({ subject: 'Confirm', text: 'Confirm text', html: '<p>Confirm</p>' }),
      buildSubscribedEmail: () => ({ subject: 'Subscribed', text: 'Subscribed text', html: '<p>Subscribed</p>' }),
      buildUnsubscribedEmail: () => ({ subject: 'Unsubscribed', text: 'Unsubscribed text', html: '<p>Unsubscribed</p>' })
    }
  };

  const subscriptions = require(subscriptionsPath);

  return {
    subscriptions,
    restore() {
      delete require.cache[subscriptionsPath];
      delete require.cache[awsClientsPath];
      delete require.cache[emailTemplatesPath];

      for (const [key, value] of Object.entries(previousEnv)) {
        if (typeof value === 'undefined') {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };
}

test('requestSubscription uses an atomic conditional write and de-duplicates topics', async () => {
  const ddbCalls = [];
  const sesCalls = [];
  const { subscriptions, restore } = loadSubscriptionsWithStubs({
    ddbSend: async (command) => {
      ddbCalls.push(command);
      return {};
    },
    sesSend: async (command) => {
      sesCalls.push(command);
      return { MessageId: 'ses-123' };
    }
  });

  try {
    const result = await subscriptions.requestSubscription({
      email: '  Test@Example.com ',
      topics: ['blog_posts', 'BLOG_POSTS', 'major_updates', 'invalid-topic'],
      source: 'portfolio-site'
    });

    assert.equal(result.ok, true);
    assert.equal(ddbCalls[0].constructor.name, 'UpdateCommand');
    assert.match(ddbCalls[0].input.ConditionExpression, /attribute_not_exists\(#status\)/);
    assert.deepEqual(ddbCalls[0].input.ExpressionAttributeValues[':topics'], ['blog_posts', 'major_updates']);
    assert.equal(ddbCalls[1].constructor.name, 'PutCommand');
    assert.equal(sesCalls.length, 1);
  } finally {
    restore();
  }
});

test('requestSubscription returns ALREADY_SUBSCRIBED after a conditional-write conflict', async () => {
  const conditionalErr = new Error('conditional');
  conditionalErr.name = 'ConditionalCheckFailedException';
  let callCount = 0;

  const { subscriptions, restore } = loadSubscriptionsWithStubs({
    ddbSend: async (command) => {
      callCount += 1;
      if (callCount === 1) throw conditionalErr;
      if (command.constructor.name === 'GetCommand') {
        return { Item: { status: 'SUBSCRIBED', updatedAt: new Date().toISOString() } };
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    },
    sesSend: async () => {
      throw new Error('SES should not be called');
    }
  });

  try {
    const result = await subscriptions.requestSubscription({
      email: 'test@example.com',
      topics: ['blog_posts']
    });

    assert.equal(result.status, 'ALREADY_SUBSCRIBED');
    assert.equal(result.alreadySubscribed, true);
  } finally {
    restore();
  }
});

test('requestSubscription returns ALREADY_PENDING after a conditional-write conflict inside cooldown', async () => {
  const conditionalErr = new Error('conditional');
  conditionalErr.name = 'ConditionalCheckFailedException';
  const pendingIso = new Date().toISOString();
  let callCount = 0;

  const { subscriptions, restore } = loadSubscriptionsWithStubs({
    ddbSend: async (command) => {
      callCount += 1;
      if (callCount === 1) throw conditionalErr;
      if (command.constructor.name === 'GetCommand') {
        return { Item: { status: 'PENDING', updatedAt: pendingIso } };
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    },
    sesSend: async () => {
      throw new Error('SES should not be called');
    }
  });

  try {
    const result = await subscriptions.requestSubscription({
      email: 'test@example.com',
      topics: ['blog_posts']
    });

    assert.equal(result.status, 'ALREADY_PENDING');
    assert.equal(result.alreadyPending, true);
  } finally {
    restore();
  }
});

test('confirmSubscription reaches SUBSCRIBED and sends the subscribed email', async () => {
  const ddbCalls = [];
  const sesCalls = [];
  let getCount = 0;
  const { subscriptions, restore } = loadSubscriptionsWithStubs({
    ddbSend: async (command) => {
      ddbCalls.push(command);
      if (command.constructor.name === 'GetCommand') {
        getCount += 1;
        if (getCount === 1) {
          return {
            Item: {
              action: 'confirm',
              emailHash: 'subscriber-hash',
              expiresAtEpoch: Math.floor(Date.now() / 1000) + 3600
            }
          };
        }
        return { Item: { email: 'test@example.com' } };
      }
      return {};
    },
    sesSend: async (command) => {
      sesCalls.push(command);
      return { MessageId: 'subscribed-message' };
    }
  });

  try {
    const result = await subscriptions.confirmSubscription({ token: 'valid-confirm-token' });
    const statusUpdate = ddbCalls.find((command) => command.constructor.name === 'UpdateCommand');

    assert.equal(result.status, 'SUBSCRIBED');
    assert.equal(statusUpdate.input.ExpressionAttributeValues[':subscribed'], 'SUBSCRIBED');
    assert.equal(sesCalls.length, 1);
  } finally {
    restore();
  }
});

test('getSubscriptionForEmail returns public subscription state for the signed-in email', async () => {
  const { subscriptions, restore } = loadSubscriptionsWithStubs({
    ddbSend: async (command) => {
      assert.equal(command.constructor.name, 'GetCommand');
      return {
        Item: {
          email: 'test@example.com',
          status: 'SUBSCRIBED',
          topics: ['blog_posts', 'major_updates'],
          source: 'blog-list',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          confirmedAt: '2026-01-02T00:00:00.000Z'
        }
      };
    }
  });

  try {
    const result = await subscriptions.getSubscriptionForEmail({ email: ' Test@Example.com ' });

    assert.equal(result.email, 'test@example.com');
    assert.equal(result.status, 'SUBSCRIBED');
    assert.deepEqual(result.topics, ['blog_posts', 'major_updates']);
    assert.equal(result.confirmedAt, '2026-01-02T00:00:00.000Z');
  } finally {
    restore();
  }
});

test('getSubscriptionForEmail returns NONE when the account has no subscription record', async () => {
  const { subscriptions, restore } = loadSubscriptionsWithStubs({
    ddbSend: async (command) => {
      assert.equal(command.constructor.name, 'GetCommand');
      return {};
    }
  });

  try {
    const result = await subscriptions.getSubscriptionForEmail({ email: 'none@example.com' });

    assert.equal(result.email, 'none@example.com');
    assert.equal(result.status, 'NONE');
    assert.deepEqual(result.topics, []);
  } finally {
    restore();
  }
});

test('updatePreferencesForEmail only updates existing active subscriptions', async () => {
  const calls = [];
  const { subscriptions, restore } = loadSubscriptionsWithStubs({
    ddbSend: async (command) => {
      calls.push(command);
      if (command.constructor.name === 'GetCommand' && calls.length === 1) {
        return { Item: { email: 'test@example.com', status: 'SUBSCRIBED', topics: ['blog_posts'] } };
      }
      if (command.constructor.name === 'UpdateCommand') {
        assert.deepEqual(command.input.ExpressionAttributeValues[':topics'], ['major_updates']);
        return {};
      }
      if (command.constructor.name === 'GetCommand') {
        return { Item: { email: 'test@example.com', status: 'SUBSCRIBED', topics: ['major_updates'] } };
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    }
  });

  try {
    const result = await subscriptions.updatePreferencesForEmail({
      email: 'test@example.com',
      topics: ['major_updates']
    });

    assert.equal(result.status, 'SUBSCRIBED');
    assert.deepEqual(result.topics, ['major_updates']);
    assert.equal(calls[1].constructor.name, 'UpdateCommand');
  } finally {
    restore();
  }
});

test('unsubscribeEmail marks subscriptions unsubscribed and clears active topics', async () => {
  const calls = [];
  const { subscriptions, restore } = loadSubscriptionsWithStubs({
    ddbSend: async (command) => {
      calls.push(command);
      if (command.constructor.name === 'GetCommand') {
        return { Item: { email: 'test@example.com', status: 'SUBSCRIBED', topics: ['blog_posts'] } };
      }
      if (command.constructor.name === 'UpdateCommand') {
        assert.equal(command.input.ExpressionAttributeValues[':unsub'], 'UNSUBSCRIBED');
        assert.deepEqual(command.input.ExpressionAttributeValues[':topics'], []);
        return {};
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    }
  });

  try {
    const result = await subscriptions.unsubscribeEmail({ email: 'test@example.com' });

    assert.equal(result.status, 'UNSUBSCRIBED');
    assert.deepEqual(result.topics, []);
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});
