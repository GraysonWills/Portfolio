import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { initializeBlogAutomation } from '../core/blog-sync';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>();
    const installedAt = await initializeBlogAutomation();

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Initialized blog automation in ${context.subredditName} at ${installedAt}; only newer posts will publish (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Blog automation initialization failed: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to initialize blog automation',
      },
      400
    );
  }
});
