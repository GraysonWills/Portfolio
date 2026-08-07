const test = require('node:test');
const assert = require('node:assert/strict');

const socialDistribution = require('../src/services/social-distribution');
const notifications = require('../src/services/notifications');

test('identifies Mesh-managed per-post copy so global rules cannot duplicate it', () => {
  const platforms = notifications.meshManagedSocialPlatforms({
    socialAutomation: {
      source: 'mesh',
      copy: {
        linkedin: 'LinkedIn summary.',
        mastodon: 'Mastodon summary.',
        threads: 'Threads summary.',
      },
    },
  });

  assert.deepEqual(platforms, ['linkedin', 'mastodon', 'threads']);
  assert.deepEqual(notifications.meshManagedSocialPlatforms({
    socialAutomation: { source: 'authoring', copy: { linkedin: 'Template copy.' } },
  }), []);
});

test('normalizes social distribution settings with default templates and rules', () => {
  const settings = socialDistribution.normalizeSettings({
    templates: [
      {
        id: 'custom',
        name: 'Custom',
        platformId: 'x',
        destination: 'Single post',
        body: '{{title}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      }
    ],
    rules: [
      {
        id: 'custom-rule',
        name: 'Custom rule',
        trigger: 'blog_published',
        enabled: true,
        templateId: 'custom',
        platformIds: ['x'],
        delayMinutes: 0,
        requiresReview: false,
        quietMode: true
      }
    ]
  });

  assert.ok(settings.templates.some((template) => template.id === 'launch-note'));
  assert.ok(settings.templates.some((template) => template.id === 'custom'));
  assert.ok(settings.templates.some((template) => template.id === 'threads-short-post'));
  assert.ok(settings.templates.some((template) => template.id === 'tiktok-photo-upload'));
  assert.ok(settings.templates.some((template) => template.id === 'reddit-profile-link'));
  assert.ok(settings.templates.some((template) => template.id === 'pinterest-blog-pin'));
  assert.ok(settings.templates.some((template) => template.id === 'mastodon-status'));
  assert.ok(settings.templates.some((template) => template.id === 'tumblr-link-post'));
  assert.ok(settings.templates.some((template) => template.id === 'medium-draft'));
  assert.ok(settings.templates.some((template) => template.id === 'discord-announcement'));
  assert.ok(settings.rules.some((rule) => rule.id === 'publish-announcement'));
  assert.ok(settings.rules.some((rule) => rule.id === 'custom-rule'));
});

test('renders automation previews with deterministic variables', () => {
  const settings = socialDistribution.normalizeSettings({
    templates: [
      {
        id: 'short',
        name: 'Short',
        platformId: 'x',
        destination: 'Single post',
        body: '{{title}} {{url}}',
        hashtags: '{{tags}}',
        useCoverImage: false
      }
    ],
    rules: [
      {
        id: 'rule',
        name: 'Rule',
        trigger: 'blog_published',
        enabled: true,
        templateId: 'short',
        platformIds: ['x'],
        delayMinutes: 2,
        requiresReview: false,
        quietMode: true
      }
    ]
  });

  const previews = socialDistribution.buildPreviews(settings, {
    title: 'Hello',
    summary: 'Summary',
    url: 'https://example.test/post',
    category: 'Writing',
    tags: '#writing',
    publishedDate: 'Jun 12',
    readingTime: '3 min read',
    coverImage: ''
  }, 'blog_published', new Date('2026-06-12T12:00:00Z'));

  const custom = previews.find((preview) => preview.ruleId === 'rule');
  assert.equal(custom.caption, 'Hello https://example.test/post\n\n#writing');
  assert.equal(custom.runAt.toISOString(), '2026-06-12T12:02:00.000Z');
});

test('builds stable delivery ids from post, rule, provider, and account', () => {
  const first = socialDistribution.getDeliveryId({
    listItemID: 'blog-1',
    trigger: 'blog_published',
    ruleId: 'rule',
    provider: 'x',
    accountId: '123'
  });
  const second = socialDistribution.getDeliveryId({
    listItemID: 'blog-1',
    trigger: 'blog_published',
    ruleId: 'rule',
    provider: 'x',
    accountId: '123'
  });
  const third = socialDistribution.getDeliveryId({
    listItemID: 'blog-1',
    trigger: 'blog_published',
    ruleId: 'rule',
    provider: 'x',
    accountId: '456'
  });

  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.equal(first.length, 64);
});

test('posts X deliveries through current api.x.com endpoint', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({ data: { id: 'tweet-1' } })
    };
  };

  const result = await socialDistribution.__private.postToX({
    token: { access_token: 'x-token' }
  }, {
    caption: 'New post https://example.test'
  });

  assert.equal(result.providerPostId, 'tweet-1');
  assert.equal(result.providerPostUrl, 'https://x.com/i/web/status/tweet-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.x.com/2/tweets');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer x-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: 'New post https://example.test' });
});

test('uploads an image before creating a LinkedIn personal-profile post', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          value: {
            uploadMechanism: {
              'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
                uploadUrl: 'https://media-upload.example.test/image'
              }
            },
            asset: 'urn:li:digitalmediaAsset:image-1'
          }
        })
      };
    }
    if (calls.length === 2) {
      return {
        ok: true,
        headers: {
          get: (name) => ({
            'content-type': 'image/jpeg',
            'content-length': '4'
          }[String(name).toLowerCase()] || null)
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer
      };
    }
    if (calls.length === 3) {
      return {
        ok: true,
        text: async () => ''
      };
    }
    return {
      ok: true,
      headers: {
        get: (name) => String(name).toLowerCase() === 'x-restli-id' ? 'ugc-post-1' : null
      },
      text: async () => ''
    };
  };

  const result = await socialDistribution.__private.postToLinkedIn({
    accountId: 'person-1',
    token: { access_token: 'linkedin-token' }
  }, {
    caption: 'I have been publishing to my blog.',
    title: "Want It, Don't Need It",
    mediaUrl: 'https://images.example.test/cover.jpg'
  });

  assert.equal(result.providerPostId, 'ugc-post-1');
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, 'https://api.linkedin.com/v2/assets?action=registerUpload');
  assert.equal(calls[1].url, 'https://images.example.test/cover.jpg');
  assert.equal(calls[2].url, 'https://media-upload.example.test/image');
  assert.equal(calls[2].options.method, 'PUT');
  assert.equal(calls[3].url, 'https://api.linkedin.com/v2/ugcPosts');
  const postBody = JSON.parse(calls[3].options.body);
  const share = postBody.specificContent['com.linkedin.ugc.ShareContent'];
  assert.equal(postBody.author, 'urn:li:person:person-1');
  assert.equal(share.shareMediaCategory, 'IMAGE');
  assert.equal(share.media[0].media, 'urn:li:digitalmediaAsset:image-1');
});

test('uploads an MP4 before creating a LinkedIn personal-profile video post', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          value: {
            uploadMechanism: {
              'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
                uploadUrl: 'https://media-upload.example.test/video'
              }
            },
            asset: 'urn:li:digitalmediaAsset:video-1'
          }
        })
      };
    }
    if (calls.length === 2) {
      return {
        ok: true,
        headers: {
          get: (name) => ({
            'content-type': 'video/mp4',
            'content-length': '4'
          }[String(name).toLowerCase()] || null)
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer
      };
    }
    if (calls.length === 3) {
      return {
        ok: true,
        text: async () => ''
      };
    }
    return {
      ok: true,
      headers: {
        get: (name) => String(name).toLowerCase() === 'x-restli-id' ? 'ugc-video-post-1' : null
      },
      text: async () => ''
    };
  };

  const result = await socialDistribution.__private.postToLinkedIn({
    accountId: 'person-1',
    token: { access_token: 'linkedin-token' }
  }, {
    caption: 'I built a thing.',
    title: 'Focus Locker',
    mediaUrl: 'https://cdn.example.test/focus-locker.mp4'
  });

  assert.equal(result.providerPostId, 'ugc-video-post-1');
  assert.equal(calls.length, 4);
  const registerBody = JSON.parse(calls[0].options.body);
  assert.deepEqual(
    registerBody.registerUploadRequest.recipes,
    ['urn:li:digitalmediaRecipe:feedshare-video']
  );
  assert.equal(calls[1].url, 'https://cdn.example.test/focus-locker.mp4');
  assert.equal(calls[2].url, 'https://media-upload.example.test/video');
  assert.equal(calls[2].options.headers['Content-Type'], 'video/mp4');
  const postBody = JSON.parse(calls[3].options.body);
  const share = postBody.specificContent['com.linkedin.ugc.ShareContent'];
  assert.equal(share.shareMediaCategory, 'VIDEO');
  assert.equal(share.media[0].media, 'urn:li:digitalmediaAsset:video-1');
});

function instagramGraphMock(calls, { permalink = 'https://www.instagram.com/p/ABC123/' } = {}) {
  let containerCount = 0;
  return async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    let payload;
    if (/\/media_publish$/.test(target)) payload = { id: 'media-1' };
    else if (/\/media$/.test(target)) payload = { id: `creation-${containerCount += 1}` };
    else if (/fields=status_code/.test(target)) payload = { status_code: 'FINISHED' };
    else if (/fields=permalink/.test(target)) payload = { permalink };
    else payload = {};
    return { ok: true, text: async () => JSON.stringify(payload) };
  };
}

const igCredential = {
  family: 'instagram',
  accountId: '17841400000000000',
  token: { access_token: 'ig-token' }
};

test('posts direct Instagram feed deliveries with tags and a permalink', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = instagramGraphMock(calls);

  const result = await socialDistribution.__private.postToInstagram(igCredential, {
    caption: 'New post',
    destination: 'feed-post',
    mediaUrl: 'https://cdn.example.test/cover.jpg',
    providerOptions: {
      instagram: {
        igMediaType: 'feed',
        items: [{
          mediaUrl: 'https://cdn.example.test/cover.jpg',
          mediaType: 'image/jpeg',
          userTags: [{ username: 'graysonwills', x: 0.25, y: 0.75 }],
          altText: 'Morning desk'
        }],
        collaborators: ['cohost'],
        locationId: '12345'
      }
    }
  });

  assert.equal(result.providerPostId, 'media-1');
  assert.equal(result.providerPostUrl, 'https://www.instagram.com/p/ABC123/');
  // create container -> status poll -> publish -> permalink
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, 'https://graph.instagram.com/v23.0/17841400000000000/media');
  const createBody = String(calls[0].options.body);
  assert.match(createBody, /caption=New\+post/);
  assert.match(createBody, /user_tags=/);
  assert.match(createBody, /collaborators=/);
  assert.match(createBody, /location_id=12345/);
  assert.match(createBody, /alt_text=Morning\+desk/);
  assert.match(calls[1].url, /fields=status_code/);
  assert.equal(calls[2].url, 'https://graph.instagram.com/v23.0/17841400000000000/media_publish');
  assert.match(calls[3].url, /fields=permalink/);
});

test('posts Instagram reels with cover offset, share_to_feed, and username tags', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = instagramGraphMock(calls);

  const result = await socialDistribution.__private.postToInstagram(igCredential, {
    caption: 'A reel',
    mediaUrl: 'https://cdn.example.test/clip.mp4',
    providerOptions: {
      instagram: {
        igMediaType: 'reel',
        items: [{
          mediaUrl: 'https://cdn.example.test/clip.mp4',
          mediaType: 'video/mp4',
          userTags: [{ username: 'graysonwills' }]
        }],
        thumbOffsetMs: 1500,
        shareToFeed: false
      }
    }
  });

  assert.equal(result.providerPostId, 'media-1');
  const createBody = String(calls[0].options.body);
  assert.match(createBody, /media_type=REELS/);
  assert.match(createBody, /video_url=/);
  assert.match(createBody, /share_to_feed=false/);
  assert.match(createBody, /thumb_offset=1500/);
  assert.match(createBody, /user_tags=/);
  assert.ok(!/alt_text=/.test(createBody));
});

test('posts Instagram carousels through per-child containers', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = instagramGraphMock(calls);

  const result = await socialDistribution.__private.postToInstagram(igCredential, {
    caption: 'Carousel',
    providerOptions: {
      instagram: {
        igMediaType: 'carousel',
        items: [
          { mediaUrl: 'https://cdn.example.test/a.jpg', mediaType: 'image/jpeg' },
          { mediaUrl: 'https://cdn.example.test/b.mp4', mediaType: 'video/mp4' }
        ]
      }
    }
  });

  assert.equal(result.providerPostId, 'media-1');
  const bodies = calls.map((call) => String(call.options?.body || ''));
  assert.match(bodies[0], /image_url=/);
  assert.match(bodies[0], /is_carousel_item=true/);
  const videoChild = bodies.find((body) => /media_type=VIDEO/.test(body));
  assert.ok(videoChild, 'video child container created');
  const parent = bodies.find((body) => /media_type=CAROUSEL/.test(body));
  assert.ok(parent, 'parent carousel container created');
  assert.match(parent, /children=creation-1%2Ccreation-2/);
});

test('posts Instagram stories without caption or tags', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = instagramGraphMock(calls);

  await socialDistribution.__private.postToInstagram(igCredential, {
    caption: '',
    destination: 'Story',
    mediaUrl: 'https://cdn.example.test/story.mp4',
    providerOptions: { instagram: { igMediaType: 'story' } }
  });

  const createBody = String(calls[0].options.body);
  assert.match(createBody, /media_type=STORIES/);
  assert.match(createBody, /video_url=/);
  assert.ok(!/caption=/.test(createBody));
});

test('legacy Instagram deliveries without provider options still post as before', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = instagramGraphMock(calls, { permalink: '' });

  const result = await socialDistribution.__private.postToInstagram(igCredential, {
    caption: 'New post',
    destination: 'feed-post',
    mediaUrl: 'https://cdn.example.test/cover.jpg'
  });

  assert.equal(result.providerPostId, 'media-1');
  assert.match(String(calls[0].options.body), /caption=New\+post/);
  assert.match(String(calls[0].options.body), /image_url=/);
});

test('a failed Instagram container stops the delivery loudly', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    const payload = /\/media$/.test(target)
      ? { id: 'creation-1' }
      : { status_code: 'ERROR' };
    return { ok: true, text: async () => JSON.stringify(payload) };
  };

  await assert.rejects(
    socialDistribution.__private.postToInstagram(igCredential, {
      caption: 'Broken',
      mediaUrl: 'https://cdn.example.test/cover.jpg',
      providerOptions: { instagram: { igMediaType: 'feed' } }
    }),
    /container error/
  );
});

test('uploads TikTok photo deliveries through the Content Posting API', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        data: { publish_id: 'publish-1' },
        error: { code: 'ok', message: '' }
      })
    };
  };

  const result = await socialDistribution.__private.postToTikTok({
    token: { access_token: 'tiktok-token' }
  }, {
    caption: 'New post\n\nhttps://example.test/blog',
    postTitle: 'A thoughtful long-form post',
    mediaUrl: 'https://cdn.example.test/cover.jpg'
  });

  assert.equal(result.providerPostId, 'publish-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://open.tiktokapis.com/v2/post/publish/content/init/');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tiktok-token');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.post_mode, 'MEDIA_UPLOAD');
  assert.equal(body.media_type, 'PHOTO');
  assert.equal(body.post_info.title, 'A thoughtful long-form post');
  assert.equal(body.post_info.description, 'New post\n\nhttps://example.test/blog');
  assert.equal(body.source_info.source, 'PULL_FROM_URL');
  assert.deepEqual(body.source_info.photo_images, ['https://cdn.example.test/cover.jpg']);
});

test('posts Reddit profile link deliveries through oauth.reddit.com', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        json: {
          errors: [],
          data: {
            id: 'abc123',
            url: 'https://www.reddit.com/r/u_author/comments/abc123/new_post/'
          }
        }
      })
    };
  };

  const result = await socialDistribution.__private.postToReddit({
    accountId: 'author',
    account: {
      id: 'author',
      extra: { profileSubreddit: 'u_author' }
    },
    token: { access_token: 'reddit-token' }
  }, {
    title: 'New post',
    caption: 'A post summary',
    destination: 'Profile post',
    postUrl: 'https://example.test/blog/new-post'
  });

  assert.equal(result.providerPostId, 'abc123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth.reddit.com/api/submit');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer reddit-token');
  assert.match(calls[0].options.headers['User-Agent'], /grayson-wills-portfolio/);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('kind'), 'link');
  assert.equal(body.get('sr'), 'u_author');
  assert.equal(body.get('title'), 'New post');
  assert.equal(body.get('url'), 'https://example.test/blog/new-post');
});

test('posts Pinterest image pins to the selected board', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: 'pin-1',
        link: 'https://www.pinterest.com/pin/pin-1/'
      })
    };
  };

  const result = await socialDistribution.__private.postToPinterest({
    accountId: 'board-1',
    token: { access_token: 'pinterest-token' }
  }, {
    title: 'New blog post',
    caption: 'A visual announcement',
    postUrl: 'https://example.test/blog/new-post',
    mediaUrl: 'https://cdn.example.test/cover.jpg'
  });

  assert.equal(result.providerPostId, 'pin-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.pinterest.com/v5/pins');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer pinterest-token');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.board_id, 'board-1');
  assert.equal(body.title, 'New blog post');
  assert.equal(body.link, 'https://example.test/blog/new-post');
  assert.deepEqual(body.media_source, {
    source_type: 'image_url',
    url: 'https://cdn.example.test/cover.jpg'
  });
});

test('posts Mastodon statuses through the configured instance', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: 'status-1',
        url: 'https://mastodon.example/@author/123'
      })
    };
  };

  const result = await socialDistribution.__private.postToMastodon({
    account: { extra: { instanceUrl: 'https://mastodon.example' } },
    token: { access_token: 'mastodon-token' }
  }, {
    caption: 'New post https://example.test',
    destination: 'Unlisted post'
  });

  assert.equal(result.providerPostId, 'status-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mastodon.example/api/v1/statuses');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer mastodon-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    status: 'New post https://example.test',
    visibility: 'unlisted'
  });
});

test('posts Tumblr link deliveries to the selected blog', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        response: {
          id_string: 'tumblr-post-1',
          post_url: 'https://author.tumblr.com/post/tumblr-post-1'
        }
      })
    };
  };

  const result = await socialDistribution.__private.postToTumblr({
    account: { extra: { name: 'author' } },
    token: { access_token: 'tumblr-token' }
  }, {
    title: 'New post',
    caption: 'A post summary #writing #blog',
    destination: 'Link post',
    postUrl: 'https://example.test/blog/new-post'
  });

  assert.equal(result.providerPostId, 'tumblr-post-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.tumblr.com/v2/blog/author/posts');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tumblr-token');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.type, 'link');
  assert.equal(body.state, 'published');
  assert.equal(body.url, 'https://example.test/blog/new-post');
  assert.equal(body.tags, 'writing,blog');
});

test('posts Medium drafts with canonical blog URLs', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        data: {
          id: 'medium-post-1',
          url: 'https://medium.com/@author/medium-post-1'
        }
      })
    };
  };

  const result = await socialDistribution.__private.postToMedium({
    accountId: 'author-id',
    token: { access_token: 'medium-token' }
  }, {
    title: 'New post',
    caption: '# New post\n\nA post summary #writing #blog #creative #extra',
    destination: 'Draft',
    postUrl: 'https://example.test/blog/new-post'
  });

  assert.equal(result.providerPostId, 'medium-post-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.medium.com/v1/users/author-id/posts');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer medium-token');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.contentFormat, 'markdown');
  assert.equal(body.publishStatus, 'draft');
  assert.equal(body.canonicalUrl, 'https://example.test/blog/new-post');
  assert.deepEqual(body.tags, ['writing', 'blog', 'creative']);
});

test('posts Discord announcements through the configured webhook', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  const previousWebhook = process.env.SOCIAL_DISCORD_WEBHOOK_URL;

  t.after(() => {
    global.fetch = originalFetch;
    if (previousWebhook === undefined) delete process.env.SOCIAL_DISCORD_WEBHOOK_URL;
    else process.env.SOCIAL_DISCORD_WEBHOOK_URL = previousWebhook;
  });

  process.env.SOCIAL_DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/token';
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: 'message-1',
        channel_id: 'channel-1'
      })
    };
  };

  const result = await socialDistribution.__private.postToDiscord(null, {
    title: 'New post',
    caption: 'New post is live https://example.test/blog/new-post',
    postUrl: 'https://example.test/blog/new-post',
    mediaUrl: 'https://cdn.example.test/cover.jpg'
  });

  assert.equal(result.providerPostId, 'message-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://discord.com/api/webhooks/123/token?wait=true');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.content, 'New post is live https://example.test/blog/new-post');
  assert.equal(body.embeds[0].title, 'New post');
  assert.equal(body.embeds[0].url, 'https://example.test/blog/new-post');
  assert.deepEqual(body.embeds[0].image, { url: 'https://cdn.example.test/cover.jpg' });
});
