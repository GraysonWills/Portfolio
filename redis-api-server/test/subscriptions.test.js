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
