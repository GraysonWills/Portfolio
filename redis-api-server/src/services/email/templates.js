function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(url) {
  return escapeHtml(String(url || '').trim());
}

function renderTagPills(tags = []) {
  const list = Array.isArray(tags) ? tags : [];
  const clean = list
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!clean.length) return '';

  const pills = clean.map((t) => `
    <span style="display:inline-block; padding: 4px 10px; border-radius: 999px; border: 1px solid #e5e7eb; background: #f9fafb; color:#111827; font-size:12px; font-weight:700; margin: 0 6px 6px 0;">
      ${escapeHtml(t)}
    </span>
  `.trim()).join('');

  return `<div style="margin: 10px 0 4px;">${pills}</div>`;
}

function buildConfirmEmail({ confirmUrl }) {
  const subject = 'Confirm your subscription';
  const text = [
    'Confirm your email subscription:',
    confirmUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin: 0 0 12px;">Confirm your subscription</h2>
      <p style="margin: 0 0 16px;">Click the button below to confirm.</p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(confirmUrl)}"
           style="display: inline-block; background: #0b4f9f; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: 700;">
           Confirm Subscription
        </a>
      </p>
      <p style="margin: 0; color: #6b7280; font-size: 13px;">
        If you did not request this, you can ignore this email.
      </p>
    </div>
  `.trim();

  return { subject, text, html };
}

function buildSubscribedEmail({ blogUrl, unsubscribeUrl }) {
  const subject = 'You’re subscribed';
  const text = [
    'You’re subscribed to Grayson’s blog updates.',
    '',
    `Blog: ${blogUrl}`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.55; color: #111827;">
      <div style="max-width: 560px; margin: 0 auto; padding: 18px 12px;">
        <div style="border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0b4f9f 0%, #f18f3b 100%); padding: 18px;">
            <div style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.85); font-weight: 700;">
              Subscription confirmed
            </div>
            <div style="font-size: 22px; color: #ffffff; margin-top: 8px; font-weight: 800;">
              You’re subscribed
            </div>
          </div>
          <div style="padding: 18px;">
            <p style="margin: 0 0 14px; color: #374151;">
              Thanks for subscribing to Grayson’s blog updates. You’ll get an email whenever a new post is published.
            </p>
            <p style="margin: 0 0 18px;">
              <a href="${safeUrl(blogUrl)}"
                 style="display: inline-block; background: #0b4f9f; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: 700;">
                 Visit the blog
              </a>
            </p>
            <p style="margin: 0; color: #6b7280; font-size: 13px;">
              If you ever change your mind:
              <a href="${safeUrl(unsubscribeUrl)}" style="color: #0b4f9f; text-decoration: underline;">Unsubscribe</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}

function buildUnsubscribedEmail({ resubscribeUrl, blogUrl }) {
  const subject = 'You’re unsubscribed';
  const text = [
    'You have been unsubscribed from Grayson’s blog updates.',
    '',
    blogUrl ? `Blog: ${blogUrl}` : null,
    resubscribeUrl ? `Resubscribe: ${resubscribeUrl}` : null,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.55; color: #111827;">
      <div style="max-width: 560px; margin: 0 auto; padding: 18px 12px;">
        <div style="border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden;">
          <div style="background: #111827; padding: 18px;">
            <div style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.85); font-weight: 700;">
              Preferences updated
            </div>
            <div style="font-size: 22px; color: #ffffff; margin-top: 8px; font-weight: 800;">
              You’re unsubscribed
            </div>
          </div>
          <div style="padding: 18px;">
            <p style="margin: 0 0 14px; color: #374151;">
              You’ve been removed from the mailing list and won’t receive further notifications.
            </p>
            ${resubscribeUrl ? `
              <p style="margin: 0 0 18px;">
                <a href="${safeUrl(resubscribeUrl)}"
                   style="display: inline-block; background: #0b4f9f; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: 700;">
                   Resubscribe
                </a>
              </p>
            `.trim() : ''}
            ${blogUrl ? `
              <p style="margin: 0; color: #6b7280; font-size: 13px;">
                You can still read posts anytime at
                <a href="${safeUrl(blogUrl)}" style="color: #0b4f9f; text-decoration: underline;">the blog</a>.
              </p>
            `.trim() : ''}
          </div>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}

function buildNewPostEmail({ title, summary, postUrl, unsubscribeUrl, imageUrl, tags, readTimeMinutes }) {
  const safeTitle = title || 'New blog post';
  const safeSummary = summary || '';
  const safeReadTime = Number.isFinite(readTimeMinutes) && readTimeMinutes > 0
    ? Math.round(readTimeMinutes)
    : null;

  const subject = safeTitle;
  const text = [
    safeTitle,
    '',
    safeSummary,
    safeReadTime ? `Read time: ${safeReadTime} min` : null,
    Array.isArray(tags) && tags.length ? `Tags: ${tags.join(', ')}` : null,
    '',
    `Read: ${postUrl}`,
    '',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.55; color: #111827;">
      <div style="max-width: 560px; margin: 0 auto; padding: 18px 12px;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
          ${escapeHtml(safeSummary || `New post: ${safeTitle}`)}
        </div>
        <div style="border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0b4f9f 0%, #f18f3b 100%); padding: 18px;">
            <div style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.85); font-weight: 700;">
              New post
            </div>
            <div style="font-size: 22px; color: #ffffff; margin-top: 8px; font-weight: 800;">
              ${escapeHtml(safeTitle)}
            </div>
          </div>
          ${imageUrl ? `
            <img src="${safeUrl(imageUrl)}" alt="${escapeHtml(safeTitle)} cover image" style="display:block; width:100%; height:auto; background:#111827;" />
          `.trim() : ''}
          <div style="padding: 18px;">
            ${safeReadTime ? `<div style="margin: 0 0 10px; color:#6b7280; font-size: 13px; font-weight: 700;">${escapeHtml(`${safeReadTime} min read`)}</div>` : ''}
            ${safeSummary ? `<p style="margin: 0 0 14px; color: #374151;">${escapeHtml(safeSummary)}</p>` : ''}
            ${renderTagPills(tags)}
            <p style="margin: 0 0 18px;">
              <a href="${escapeHtml(postUrl)}"
                 style="display: inline-block; background: #0b4f9f; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: 700;">
                 Read the post
              </a>
            </p>
            <p style="margin: 0; color: #6b7280; font-size: 13px;">
              You’re receiving this because you subscribed to Grayson’s blog updates.
              <a href="${escapeHtml(unsubscribeUrl)}" style="color: #0b4f9f; text-decoration: underline;">Unsubscribe</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}

module.exports = {
  buildConfirmEmail,
  buildSubscribedEmail,
  buildUnsubscribedEmail,
  buildNewPostEmail,
};
