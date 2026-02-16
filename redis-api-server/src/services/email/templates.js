function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

function buildNewPostEmail({ title, summary, postUrl, unsubscribeUrl }) {
  const safeTitle = title || 'New blog post';
  const safeSummary = summary || '';

  const subject = safeTitle;
  const text = [
    safeTitle,
    '',
    safeSummary,
    '',
    `Read: ${postUrl}`,
    '',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.55; color: #111827;">
      <div style="max-width: 560px; margin: 0 auto; padding: 18px 12px;">
        <div style="border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0b4f9f 0%, #f18f3b 100%); padding: 18px;">
            <div style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.85); font-weight: 700;">
              New post
            </div>
            <div style="font-size: 22px; color: #ffffff; margin-top: 8px; font-weight: 800;">
              ${escapeHtml(safeTitle)}
            </div>
          </div>
          <div style="padding: 18px;">
            ${safeSummary ? `<p style="margin: 0 0 14px; color: #374151;">${escapeHtml(safeSummary)}</p>` : ''}
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
  buildNewPostEmail,
};

