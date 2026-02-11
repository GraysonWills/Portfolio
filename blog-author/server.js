require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4201;
const REDIS_API = process.env.REDIS_API_URL || 'http://localhost:3000';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Proxy blog content from Redis API
app.get('/api/posts', async (req, res) => {
  try {
    const resp = await fetch(`${REDIS_API}/api/content/page/3`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a full blog post (4 items: item, text, image, body)
app.post('/api/posts', async (req, res) => {
  try {
    const { title, summary, content, imageUrl, imageAlt, tags, category, status, bodyBlocks } = req.body;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const timestamp = Date.now();
    const listItemId = `blog-post-${slug}-${timestamp}`;

    const items = [
      {
        ID: `${listItemId}-item`,
        Text: title,
        PageID: 3,
        PageContentID: 3, // BlogItem
        ListItemID: listItemId,
        Metadata: {
          title,
          summary,
          tags: tags || [],
          publishDate: new Date().toISOString(),
          status: status || 'published',
          category: category || 'General'
        }
      },
      {
        ID: `${listItemId}-text`,
        Text: content || '',
        PageID: 3,
        PageContentID: 4, // BlogText
        ListItemID: listItemId
      },
      {
        ID: `${listItemId}-image`,
        Photo: imageUrl || '',
        PageID: 3,
        PageContentID: 5, // BlogImage
        ListItemID: listItemId,
        Metadata: { alt: imageAlt || `${title} cover image` }
      },
      {
        ID: `${listItemId}-body`,
        Text: JSON.stringify(bodyBlocks || []),
        PageID: 3,
        PageContentID: 13, // BlogBody
        ListItemID: listItemId
      }
    ];

    const resp = await fetch(`${REDIS_API}/api/content/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items)
    });
    const data = await resp.json();
    res.status(201).json({ listItemId, items: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a blog post
app.put('/api/posts/:listItemId', async (req, res) => {
  try {
    const { listItemId } = req.params;
    const { title, summary, content, imageUrl, imageAlt, tags, category, status, bodyBlocks } = req.body;

    // Update the item record
    await fetch(`${REDIS_API}/api/content/${listItemId}-item`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Text: title,
        Metadata: {
          title,
          summary,
          tags: tags || [],
          publishDate: new Date().toISOString(),
          status: status || 'published',
          category: category || 'General'
        }
      })
    });

    // Update the text record
    await fetch(`${REDIS_API}/api/content/${listItemId}-text`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Text: content || '' })
    });

    // Update the image record
    await fetch(`${REDIS_API}/api/content/${listItemId}-image`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Photo: imageUrl || '',
        Metadata: { alt: imageAlt || `${title} cover image` }
      })
    });

    // Update or create the body record
    const bodyResp = await fetch(`${REDIS_API}/api/content/${listItemId}-body`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Text: JSON.stringify(bodyBlocks || []),
        PageID: 3,
        PageContentID: 13,
        ListItemID: listItemId
      })
    });

    // If body record didn't exist, create it
    if (bodyResp.status === 404) {
      await fetch(`${REDIS_API}/api/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ID: `${listItemId}-body`,
          Text: JSON.stringify(bodyBlocks || []),
          PageID: 3,
          PageContentID: 13,
          ListItemID: listItemId
        })
      });
    }

    res.json({ message: 'Post updated', listItemId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a blog post (all items by ListItemID)
app.delete('/api/posts/:listItemId', async (req, res) => {
  try {
    const resp = await fetch(`${REDIS_API}/api/content/list-item/${req.params.listItemId}`, {
      method: 'DELETE'
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`  Blog Author running at http://localhost:${PORT}`);
  console.log(`  Redis API: ${REDIS_API}`);
});
