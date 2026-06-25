import { context, redis, reddit } from '@devvit/web/server';

const BLOG_FEED_URL =
  'https://www.grayson-wills.com/api/content/v2/blog/cards?status=published&includeFuture=false&limit=12';
const BLOG_URL_BASE = 'https://www.grayson-wills.com/blog';
const POSTED_HASH = 'grayson-blog:posted';
const INSTALLED_AT_KEY = 'grayson-blog:installed-at';
const MAX_POSTS_PER_RUN = 3;

type BlogCard = {
  listItemID: string;
  title: string;
  summary?: string;
  publishDate?: string | null;
  status?: string;
};

type BlogFeedResponse = {
  items?: BlogCard[];
};

export type BlogSyncResult = {
  checked: number;
  posted: number;
  seeded: number;
  skipped: number;
};

const cleanText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const isPublishedCard = (value: unknown): value is BlogCard => {
  if (!value || typeof value !== 'object') return false;

  const card = value as Partial<BlogCard>;
  return (
    cleanText(card.listItemID).startsWith('blog-') &&
    cleanText(card.title).length > 0 &&
    cleanText(card.status || 'published').toLowerCase() === 'published'
  );
};

const publishedAt = (card: BlogCard): number => {
  const timestamp = Date.parse(cleanText(card.publishDate));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const fetchPublishedBlogs = async (): Promise<BlogCard[]> => {
  const response = await fetch(BLOG_FEED_URL, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Blog feed returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as BlogFeedResponse;
  return (Array.isArray(payload.items) ? payload.items : [])
    .filter(isPublishedCard)
    .filter((card) => publishedAt(card) <= Date.now())
    .sort((left, right) => publishedAt(left) - publishedAt(right));
};

const claimBlog = async (listItemID: string): Promise<boolean> =>
  (await redis.hSetNX(POSTED_HASH, listItemID, `claimed:${Date.now()}`)) === 1;

const releaseBlog = async (listItemID: string): Promise<void> => {
  await redis.hDel(POSTED_HASH, [listItemID]);
};

const markBlog = async (
  listItemID: string,
  status: string
): Promise<void> => {
  await redis.hSet(POSTED_HASH, {
    [listItemID]: status,
  });
};

const getSubredditName = (): string => {
  const subredditName = cleanText(context.subredditName);
  if (!subredditName) {
    throw new Error('The Devvit installation subreddit is unavailable');
  }
  return subredditName;
};

const buildPostTitle = (card: BlogCard): string =>
  `New blog post: ${cleanText(card.title)}`.slice(0, 300);

const buildPostUrl = (card: BlogCard): string =>
  `${BLOG_URL_BASE}/${encodeURIComponent(cleanText(card.listItemID))}`;

export const initializeBlogAutomation = async (): Promise<string> => {
  const installedAt = new Date().toISOString();
  await redis.set(INSTALLED_AT_KEY, installedAt, { nx: true });
  return (await redis.get(INSTALLED_AT_KEY)) || installedAt;
};

export const syncPublishedBlogs = async (): Promise<BlogSyncResult> => {
  const installedAt = await redis.get(INSTALLED_AT_KEY);
  if (!installedAt) {
    await initializeBlogAutomation();
    return {
      checked: 0,
      posted: 0,
      seeded: 0,
      skipped: 0,
    };
  }

  const installedAtMs = Date.parse(installedAt);
  const cards = await fetchPublishedBlogs();
  const eligibleCards = cards.filter(
    (card) =>
      !Number.isFinite(installedAtMs) || publishedAt(card) > installedAtMs
  );
  const result: BlogSyncResult = {
    checked: cards.length,
    posted: 0,
    seeded: 0,
    skipped: cards.length - eligibleCards.length,
  };

  const subredditName = getSubredditName();

  for (const card of eligibleCards) {
    if (result.posted >= MAX_POSTS_PER_RUN) break;

    if (!(await claimBlog(card.listItemID))) {
      result.skipped += 1;
      continue;
    }

    try {
      const post = await reddit.submitPost({
        subredditName,
        title: buildPostTitle(card),
        url: buildPostUrl(card),
        runAs: 'APP',
        sendreplies: false,
      });

      await markBlog(
        card.listItemID,
        JSON.stringify({
          postId: post.id,
          postUrl: post.url,
          postedAt: new Date().toISOString(),
        })
      );
      result.posted += 1;
    } catch (error) {
      await releaseBlog(card.listItemID);
      throw error;
    }
  }

  return result;
};
