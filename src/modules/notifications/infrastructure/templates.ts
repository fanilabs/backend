export interface RenderedNotificationEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders both HTML and plain-text (`text/plain`) representations for
 * notification emails per RFC 2046 multipart MIME accessibility and
 * deliverability requirements (#410).
 */
export function renderNotificationTemplate(
  type: string,
  payload: Record<string, unknown>,
): RenderedNotificationEmail {
  const subject = `FaniLab notification: ${type}`;
  const entries = Object.entries(payload);
  const textDetails =
    entries.length > 0
      ? entries.map(([k, v]) => `${k}: ${String(v)}`).join('\n')
      : 'No additional details.';
  const text = `${type}\n\n${textDetails}\n`;

  const htmlRows =
    entries.length > 0
      ? `<ul>${entries
          .map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</li>`)
          .join('')}</ul>`
      : '<p>No additional details.</p>';
  const html = `<!DOCTYPE html><html><body><h2>${escapeHtml(subject)}</h2>${htmlRows}</body></html>`;

  return { subject, text, html };
}
