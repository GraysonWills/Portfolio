import { Hono } from 'hono';
import { settings } from '@devvit/web/server';
import { syncPublishedBlogs } from '../core/blog-sync';

type TaskResponse = Record<string, never>;

export const tasks = new Hono();

tasks.post('/blog-sync', async (c) => {
  try {
    const enabled = await settings.get<boolean>('automationEnabled');
    if (!enabled) {
      console.log('Scheduled blog sync is disabled');
      return c.json<TaskResponse>({}, 200);
    }

    const result = await syncPublishedBlogs();
    console.log(
      `Scheduled blog sync checked ${result.checked} posts and published ${result.posted}`
    );
    return c.json<TaskResponse>({}, 200);
  } catch (error) {
    console.error(`Scheduled blog sync failed: ${error}`);
    return c.json<TaskResponse>({}, 500);
  }
});
