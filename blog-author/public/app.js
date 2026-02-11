// ═══════════════════════════════════════════
//  Blog Author — Client Application
//  Supports card info + rich article body editing
// ═══════════════════════════════════════════

const API = '';

// ── State ──
let allPosts = [];
let currentListItemId = null;
let bodyBlocks = []; // Array of { type, content, ... }

// ── DOM refs ──
const $ = (sel) => document.querySelector(sel);
const postList       = $('#postList');
const emptyState     = $('#emptyState');
const editorPanel    = $('#editorPanel');
const cardContent    = $('#cardContent');
const bodyContent    = $('#bodyContent');
const previewContent = $('#previewContent');
const previewCard    = $('#previewCard');
const previewArticle = $('#previewArticle');
const tabCard        = $('#tabCard');
const tabBody        = $('#tabBody');
const tabPreview     = $('#tabPreview');
const searchInput    = $('#searchInput');
const btnNew         = $('#btnNew');
const btnSave        = $('#btnSave');
const btnDelete      = $('#btnDelete');
const postForm       = $('#postForm');
const imageInput     = $('#postImage');
const imgPreview     = $('#imagePreviewSmall');
const bodyBlocksEl   = $('#bodyBlocks');

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadPosts();
  bindEvents();
});

function bindEvents() {
  btnNew.addEventListener('click', newPost);
  postForm.addEventListener('submit', savePost);
  btnDelete.addEventListener('click', deletePost);
  tabCard.addEventListener('click', () => switchTab('card'));
  tabBody.addEventListener('click', () => switchTab('body'));
  tabPreview.addEventListener('click', () => switchTab('preview'));
  searchInput.addEventListener('input', renderSidebar);

  imageInput.addEventListener('input', () => {
    const url = imageInput.value.trim();
    if (url) {
      imgPreview.innerHTML = `<img src="${url}" alt="Preview" onerror="this.parentElement.style.display='none'" />`;
      imgPreview.style.display = 'block';
    } else {
      imgPreview.style.display = 'none';
    }
  });

  // Add-block buttons
  document.querySelectorAll('.add-block-btn').forEach(btn => {
    btn.addEventListener('click', () => addBlock(btn.dataset.type));
  });
}

// ════════════════════════════════════
//  API calls
// ════════════════════════════════════

async function loadPosts() {
  try {
    const resp = await fetch(`${API}/api/posts`);
    const raw = await resp.json();
    allPosts = groupByListItem(raw);
    renderSidebar();
  } catch (err) {
    toast('Failed to load posts', 'error');
    console.error(err);
  }
}

function groupByListItem(items) {
  const groups = {};
  for (const item of items) {
    const lid = item.ListItemID;
    if (!lid) continue;
    if (!groups[lid]) groups[lid] = { listItemID: lid, items: [], metadata: null };
    groups[lid].items.push(item);
    if (item.PageContentID === 3 && item.Metadata) {
      groups[lid].metadata = item.Metadata;
    }
  }
  return Object.values(groups).sort((a, b) => {
    const da = a.metadata?.publishDate ? new Date(a.metadata.publishDate) : new Date(0);
    const db = b.metadata?.publishDate ? new Date(b.metadata.publishDate) : new Date(0);
    return db - da;
  });
}

async function savePost(e) {
  e.preventDefault();

  // Sync body blocks from DOM before saving
  syncBodyBlocksFromDOM();

  const payload = getFormData();
  payload.bodyBlocks = bodyBlocks;

  if (!payload.title.trim()) { toast('Title is required', 'error'); return; }

  btnSave.disabled = true;
  btnSave.innerHTML = '<i class="pi pi-spin pi-spinner"></i> Saving...';

  try {
    const listItemId = $('#editListItemId').value;
    let resp;

    if (listItemId) {
      resp = await fetch(`${API}/api/posts/${listItemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      resp = await fetch(`${API}/api/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!resp.ok) throw new Error('Save failed');
    const data = await resp.json();

    toast(listItemId ? 'Post updated!' : 'Post published to Redis!', 'success');
    await loadPosts();

    const savedId = listItemId || data.listItemId;
    selectPost(savedId);
  } catch (err) {
    toast('Error saving post: ' + err.message, 'error');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="pi pi-save"></i> Publish to Redis';
  }
}

async function deletePost() {
  const listItemId = $('#editListItemId').value;
  if (!listItemId) return;
  if (!confirm('Delete this post? This will remove it from Redis permanently.')) return;

  try {
    await fetch(`${API}/api/posts/${listItemId}`, { method: 'DELETE' });
    toast('Post deleted', 'info');
    currentListItemId = null;
    showEmpty();
    await loadPosts();
  } catch (err) {
    toast('Error deleting: ' + err.message, 'error');
  }
}

// ════════════════════════════════════
//  Sidebar rendering
// ════════════════════════════════════

function renderSidebar() {
  const query = searchInput.value.toLowerCase();
  const filtered = allPosts.filter(p => {
    if (!query) return true;
    const m = p.metadata || {};
    const text = (m.title || '') + (m.summary || '') + (m.tags || []).join(' ');
    return text.toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    postList.innerHTML = '<li class="post-list-empty">No posts found</li>';
    return;
  }

  postList.innerHTML = filtered.map(p => {
    const m = p.metadata || {};
    const statusClass = (m.status || 'draft').toLowerCase();
    const active = p.listItemID === currentListItemId ? 'active' : '';
    const date = m.publishDate ? new Date(m.publishDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    return `
      <li class="post-list-item ${active}" data-id="${p.listItemID}">
        <div class="post-list-title">${escHtml(m.title || 'Untitled')}</div>
        <div class="post-list-meta">
          <span class="post-list-status ${statusClass}">${statusClass}</span>
          ${date ? `<span>${date}</span>` : ''}
        </div>
      </li>`;
  }).join('');

  postList.querySelectorAll('.post-list-item').forEach(el => {
    el.addEventListener('click', () => selectPost(el.dataset.id));
  });
}

// ════════════════════════════════════
//  Post selection / editing
// ════════════════════════════════════

function selectPost(listItemId) {
  currentListItemId = listItemId;
  const post = allPosts.find(p => p.listItemID === listItemId);
  if (!post) return;

  const m = post.metadata || {};
  const textItem = post.items.find(i => i.PageContentID === 4);
  const imgItem  = post.items.find(i => i.PageContentID === 5);
  const bodyItem = post.items.find(i => i.PageContentID === 13);

  $('#editListItemId').value = listItemId;
  $('#postTitle').value     = m.title || '';
  $('#postCategory').value  = m.category || 'General';
  $('#postStatus').value    = m.status || 'draft';
  $('#postTags').value      = (m.tags || []).join(', ');
  $('#postImage').value     = imgItem?.Photo || '';
  $('#postImageAlt').value  = imgItem?.Metadata?.alt || '';
  $('#postSummary').value   = m.summary || '';
  $('#postContent').value   = textItem?.Text || '';

  // Parse body blocks
  if (bodyItem?.Text) {
    try {
      bodyBlocks = JSON.parse(bodyItem.Text);
    } catch {
      bodyBlocks = [];
    }
  } else {
    bodyBlocks = [];
  }

  // Image preview
  if (imgItem?.Photo) {
    imgPreview.innerHTML = `<img src="${imgItem.Photo}" alt="Preview" />`;
    imgPreview.style.display = 'block';
  } else {
    imgPreview.style.display = 'none';
  }

  btnDelete.style.display = 'inline-flex';
  showEditor();
  switchTab('card');
  renderBodyBlocks();
  renderSidebar();
}

function newPost() {
  currentListItemId = null;
  $('#editListItemId').value = '';
  postForm.reset();
  imgPreview.style.display = 'none';
  btnDelete.style.display = 'none';
  bodyBlocks = [];
  renderBodyBlocks();
  showEditor();
  switchTab('card');
  $('#postTitle').focus();
  renderSidebar();
}

function showEditor() {
  emptyState.style.display = 'none';
  editorPanel.style.display = 'block';
}

function showEmpty() {
  emptyState.style.display = 'flex';
  editorPanel.style.display = 'none';
}

// ════════════════════════════════════
//  Tabs
// ════════════════════════════════════

function switchTab(tab) {
  tabCard.classList.toggle('active', tab === 'card');
  tabBody.classList.toggle('active', tab === 'body');
  tabPreview.classList.toggle('active', tab === 'preview');
  cardContent.style.display    = tab === 'card' ? 'block' : 'none';
  bodyContent.style.display    = tab === 'body' ? 'block' : 'none';
  previewContent.style.display = tab === 'preview' ? 'block' : 'none';

  if (tab === 'body') renderBodyBlocks();
  if (tab === 'preview') {
    syncBodyBlocksFromDOM();
    renderPreview();
  }
}

// ════════════════════════════════════
//  Body Block Editor
// ════════════════════════════════════

function addBlock(type) {
  syncBodyBlocksFromDOM();

  let block;
  switch (type) {
    case 'paragraph':
      block = { type: 'paragraph', content: '' };
      break;
    case 'heading':
      block = { type: 'heading', content: '', level: 2 };
      break;
    case 'image':
      block = { type: 'image', url: '', alt: '', caption: '' };
      break;
    case 'carousel':
      block = { type: 'carousel', images: [{ url: '', alt: '' }], caption: '' };
      break;
    case 'quote':
      block = { type: 'quote', content: '', author: '' };
      break;
    default:
      return;
  }

  bodyBlocks.push(block);
  renderBodyBlocks();

  // Scroll to the new block
  setTimeout(() => {
    const blocks = bodyBlocksEl.querySelectorAll('.block-item');
    blocks[blocks.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
}

function renderBodyBlocks() {
  if (bodyBlocks.length === 0) {
    bodyBlocksEl.innerHTML = `
      <div class="body-empty">
        <i class="pi pi-inbox"></i>
        <p>No content blocks yet. Use the buttons below to add content.</p>
      </div>`;
    return;
  }

  bodyBlocksEl.innerHTML = bodyBlocks.map((block, i) => {
    const typeLabel = block.type.charAt(0).toUpperCase() + block.type.slice(1);
    const isFirst = i === 0;
    const isLast = i === bodyBlocks.length - 1;

    let fields = '';

    switch (block.type) {
      case 'paragraph':
        fields = `
          <div class="block-toolbar">
            <button type="button" class="toolbar-btn" title="Bold" onclick="insertMarkdown(${i}, '**', '**')"><b>B</b></button>
            <button type="button" class="toolbar-btn" title="Italic" onclick="insertMarkdown(${i}, '*', '*')"><i>I</i></button>
            <button type="button" class="toolbar-btn" title="Code" onclick="insertMarkdown(${i}, '\`', '\`')"><code>&lt;/&gt;</code></button>
            <button type="button" class="toolbar-btn" title="Link" onclick="insertMarkdown(${i}, '[', '](url)')"><i class="pi pi-link"></i></button>
            <button type="button" class="toolbar-btn" title="Bullet List" onclick="insertMarkdown(${i}, '\\n- ', '')"><i class="pi pi-list"></i></button>
          </div>
          <textarea class="block-textarea" data-idx="${i}" data-field="content" rows="5" placeholder="Write paragraph content (Markdown supported: **bold**, *italic*, [links](url))...">${escHtml(block.content)}</textarea>`;
        break;

      case 'heading':
        fields = `
          <div class="block-inline">
            <select class="block-select" data-idx="${i}" data-field="level">
              <option value="2" ${block.level === 2 ? 'selected' : ''}>H2</option>
              <option value="3" ${block.level === 3 ? 'selected' : ''}>H3</option>
              <option value="4" ${block.level === 4 ? 'selected' : ''}>H4</option>
            </select>
            <input type="text" class="block-input" data-idx="${i}" data-field="content" value="${escAttr(block.content)}" placeholder="Heading text..." />
          </div>`;
        break;

      case 'image':
        fields = `
          <input type="url" class="block-input" data-idx="${i}" data-field="url" value="${escAttr(block.url)}" placeholder="Image URL (https://...)" />
          <div class="block-inline">
            <input type="text" class="block-input flex-1" data-idx="${i}" data-field="alt" value="${escAttr(block.alt)}" placeholder="Alt text" />
            <input type="text" class="block-input flex-1" data-idx="${i}" data-field="caption" value="${escAttr(block.caption || '')}" placeholder="Caption (optional)" />
          </div>
          ${block.url ? `<div class="block-img-preview"><img src="${escAttr(block.url)}" alt="" onerror="this.style.display='none'" /></div>` : ''}`;
        break;

      case 'carousel':
        const imagesHtml = (block.images || []).map((img, j) => `
          <div class="carousel-img-row" data-carousel-idx="${j}">
            <input type="url" class="block-input flex-2" data-idx="${i}" data-carousel="${j}" data-field="url" value="${escAttr(img.url)}" placeholder="Image ${j + 1} URL" />
            <input type="text" class="block-input flex-1" data-idx="${i}" data-carousel="${j}" data-field="alt" value="${escAttr(img.alt)}" placeholder="Alt text" />
            <button type="button" class="block-icon-btn danger" title="Remove image" onclick="removeCarouselImage(${i}, ${j})"><i class="pi pi-times"></i></button>
          </div>
        `).join('');

        fields = `
          <div class="carousel-images">${imagesHtml}</div>
          <button type="button" class="btn-sm btn-outline" onclick="addCarouselImage(${i})"><i class="pi pi-plus"></i> Add Image</button>
          <input type="text" class="block-input" data-idx="${i}" data-field="caption" value="${escAttr(block.caption || '')}" placeholder="Carousel caption (optional)" style="margin-top:0.5rem" />`;
        break;

      case 'quote':
        fields = `
          <textarea class="block-textarea" data-idx="${i}" data-field="content" rows="3" placeholder="Quote text (Markdown supported)...">${escHtml(block.content)}</textarea>
          <input type="text" class="block-input" data-idx="${i}" data-field="author" value="${escAttr(block.author || '')}" placeholder="Author (optional)" />`;
        break;
    }

    return `
      <div class="block-item" data-block-idx="${i}">
        <div class="block-header">
          <span class="block-type-badge ${block.type}">${typeLabel}</span>
          <div class="block-controls">
            <button type="button" class="block-icon-btn" title="Move up" ${isFirst ? 'disabled' : ''} onclick="moveBlock(${i}, -1)"><i class="pi pi-arrow-up"></i></button>
            <button type="button" class="block-icon-btn" title="Move down" ${isLast ? 'disabled' : ''} onclick="moveBlock(${i}, 1)"><i class="pi pi-arrow-down"></i></button>
            <button type="button" class="block-icon-btn danger" title="Delete block" onclick="removeBlock(${i})"><i class="pi pi-trash"></i></button>
          </div>
        </div>
        <div class="block-fields">${fields}</div>
      </div>`;
  }).join('');
}

/** Read DOM inputs back into bodyBlocks array */
function syncBodyBlocksFromDOM() {
  bodyBlocksEl.querySelectorAll('.block-item').forEach(el => {
    const idx = parseInt(el.dataset.blockIdx);
    const block = bodyBlocks[idx];
    if (!block) return;

    el.querySelectorAll('[data-field]').forEach(input => {
      const field = input.dataset.field;
      const carouselIdx = input.dataset.carousel;

      if (carouselIdx !== undefined) {
        // Carousel image fields
        const ci = parseInt(carouselIdx);
        if (block.images && block.images[ci]) {
          block.images[ci][field] = input.value;
        }
      } else if (field === 'level') {
        block[field] = parseInt(input.value);
      } else {
        block[field] = input.value;
      }
    });
  });
}

/** Insert Markdown formatting around selection in a textarea */
window.insertMarkdown = function(idx, before, after) {
  const textarea = bodyBlocksEl.querySelector(`textarea[data-idx="${idx}"][data-field="content"]`);
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end) || 'text';

  textarea.value = text.substring(0, start) + before + selected + after + text.substring(end);
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
};

window.moveBlock = function(idx, direction) {
  syncBodyBlocksFromDOM();
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= bodyBlocks.length) return;
  [bodyBlocks[idx], bodyBlocks[newIdx]] = [bodyBlocks[newIdx], bodyBlocks[idx]];
  renderBodyBlocks();
};

window.removeBlock = function(idx) {
  syncBodyBlocksFromDOM();
  bodyBlocks.splice(idx, 1);
  renderBodyBlocks();
};

window.addCarouselImage = function(blockIdx) {
  syncBodyBlocksFromDOM();
  if (bodyBlocks[blockIdx]?.type === 'carousel') {
    bodyBlocks[blockIdx].images.push({ url: '', alt: '' });
    renderBodyBlocks();
  }
};

window.removeCarouselImage = function(blockIdx, imgIdx) {
  syncBodyBlocksFromDOM();
  if (bodyBlocks[blockIdx]?.images) {
    bodyBlocks[blockIdx].images.splice(imgIdx, 1);
    renderBodyBlocks();
  }
};

// ════════════════════════════════════
//  Preview
// ════════════════════════════════════

function renderPreview() {
  const d = getFormData();

  // Card preview
  const tags = d.tags.slice(0, 2).map(t => `<span class="blog-tag">${escHtml(t)}</span>`).join('');
  const allText = bodyBlocks
    .filter(b => b.type === 'paragraph' || b.type === 'heading' || b.type === 'quote')
    .map(b => b.content || '')
    .join(' ');
  const wordCount = allText.trim().split(/\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  previewCard.innerHTML = `
    <div class="blog-post-content">
      ${d.imageUrl ? `<img src="${escHtml(d.imageUrl)}" alt="${escHtml(d.imageAlt)}" class="blog-image" />` : ''}
      <div class="blog-details">
        <div class="blog-meta">
          <span><i class="pi pi-calendar"></i> ${dateStr}</span>
          <span><i class="pi pi-clock"></i> ${readTime} min read</span>
        </div>
        <h3 class="blog-title">${escHtml(d.title || 'Untitled Post')}</h3>
        <p class="blog-summary">${escHtml(d.summary || '')}</p>
        <div class="blog-footer">
          <div class="blog-tags">${tags}</div>
          <span class="read-more-link">Read More <i class="pi pi-arrow-right"></i></span>
        </div>
      </div>
    </div>`;

  // Article preview
  if (bodyBlocks.length === 0) {
    previewArticle.innerHTML = '<p class="preview-empty">No article body blocks. Switch to "Article Body" tab to add content.</p>';
    return;
  }

  const articleHtml = bodyBlocks.map(block => {
    switch (block.type) {
      case 'paragraph':
        return `<div class="pv-paragraph">${renderMd(block.content)}</div>`;

      case 'heading':
        const tag = `h${block.level || 2}`;
        return `<${tag} class="pv-heading">${escHtml(block.content)}</${tag}>`;

      case 'image':
        return `
          <figure class="pv-figure">
            ${block.url ? `<img src="${escAttr(block.url)}" alt="${escAttr(block.alt)}" />` : '<div class="pv-img-placeholder">No image URL</div>'}
            ${block.caption ? `<figcaption>${escHtml(block.caption)}</figcaption>` : ''}
          </figure>`;

      case 'carousel':
        const imgs = (block.images || []).filter(img => img.url);
        if (imgs.length === 0) return '<div class="pv-img-placeholder">No carousel images</div>';
        return `
          <div class="pv-carousel">
            <div class="pv-carousel-track" data-idx="0">
              ${imgs.map((img, i) => `<img src="${escAttr(img.url)}" alt="${escAttr(img.alt)}" class="pv-carousel-img ${i === 0 ? 'active' : ''}" data-slide="${i}" />`).join('')}
            </div>
            ${imgs.length > 1 ? `<div class="pv-carousel-dots">${imgs.map((_, i) => `<button class="pv-dot ${i === 0 ? 'active' : ''}" onclick="previewSlide(this, ${i})"></button>`).join('')}</div>` : ''}
            ${block.caption ? `<p class="pv-caption">${escHtml(block.caption)}</p>` : ''}
          </div>`;

      case 'quote':
        return `
          <blockquote class="pv-quote">
            <p>${renderMd(block.content)}</p>
            ${block.author ? `<cite>— ${escHtml(block.author)}</cite>` : ''}
          </blockquote>`;

      default:
        return '';
    }
  }).join('');

  previewArticle.innerHTML = articleHtml;
}

window.previewSlide = function(dotEl, idx) {
  const carousel = dotEl.closest('.pv-carousel');
  carousel.querySelectorAll('.pv-carousel-img').forEach(img => img.classList.toggle('active', parseInt(img.dataset.slide) === idx));
  carousel.querySelectorAll('.pv-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
};

function renderMd(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined') {
    return marked.parse(text);
  }
  // Fallback: basic escaping
  return escHtml(text).replace(/\n/g, '<br>');
}

// ════════════════════════════════════
//  Helpers
// ════════════════════════════════════

function getFormData() {
  return {
    title:    $('#postTitle').value.trim(),
    category: $('#postCategory').value,
    status:   $('#postStatus').value,
    tags:     $('#postTags').value.split(',').map(t => t.trim()).filter(Boolean),
    imageUrl: $('#postImage').value.trim(),
    imageAlt: $('#postImageAlt').value.trim(),
    summary:  $('#postSummary').value.trim(),
    content:  $('#postContent').value.trim()
  };
}

function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toast(message, type = 'info') {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}
