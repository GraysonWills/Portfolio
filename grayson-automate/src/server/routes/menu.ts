import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { settings } from '@devvit/web/server';
import { syncPublishedBlogs } from '../core/blog-sync';

export const menu = new Hono();

menu.post('/blog-sync', async (c) => {
  try {
    const enabled = await settings.get<boolean>('automationEnabled');
    if (!enabled) {
      return c.json<UiResponse>(
        {
          showToast:
            'Blog automation is disabled while the domain exception is pending.',
        },
        200
      );
    }

    const result = await syncPublishedBlogs();

    return c.json<UiResponse>(
      {
        showToast:
          result.posted > 0
            ? `Published ${result.posted} new blog announcement${result.posted === 1 ? '' : 's'}`
            : 'No new blog posts to announce',
      },
      200
    );
  } catch (error) {
    console.error(`Manual blog sync failed: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Blog sync failed. Check the app logs.',
      },
      400
    );
  }
});
