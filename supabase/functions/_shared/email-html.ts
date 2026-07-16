// supabase/functions/_shared/email-html.ts
// Settings §6.A — HTML presentation layer for outgoing emails.
//
// The live pipeline stores plain text in notification_outbox (substituted at
// enqueue time). When an ACTIVE email_templates row shares the notification's
// template code, the dispatcher re-renders the message as HTML from
// body_html + the raw variables (persisted by enqueue_notification_v2), and
// wraps it in a branded shell carrying the business identity (logo / name /
// NPWP from business_config). No matching email template → text-only send,
// exactly as before.

export interface EmailBranding {
  name: string;
  npwp?: string;
  logoUrl?: string;
}

/** Mirror of _notif_substitute / composeMessage: replaces {{ var }} tokens. */
export function substituteVars(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? '' : String(v);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Substitute variables into an HTML template, HTML-escaping each value. */
export function substituteVarsHtml(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? '' : escapeHtml(String(v));
  });
}

/** Branded shell: logo + business name header, content, NPWP footer. */
export function wrapBrandedEmail(contentHtml: string, branding: EmailBranding): string {
  const logo = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${escapeHtml(branding.name)}" style="max-height:48px;max-width:220px;display:block;margin:0 auto 8px;" />`
    : '';
  const npwp = branding.npwp
    ? `<p style="margin:4px 0 0;font-size:11px;color:#8a8a8a;">NPWP ${escapeHtml(branding.npwp)}</p>`
    : '';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f3ec;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ec;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;font-family:Georgia,'Times New Roman',serif;color:#2b2b2b;">
          <tr><td align="center" style="padding-bottom:16px;border-bottom:1px solid #e8e0d0;">
            ${logo}
            <div style="font-size:20px;letter-spacing:1px;">${escapeHtml(branding.name)}</div>
          </td></tr>
          <tr><td style="padding:24px 0;font-size:14px;line-height:1.6;">
            ${contentHtml}
          </td></tr>
          <tr><td align="center" style="padding-top:16px;border-top:1px solid #e8e0d0;">
            <p style="margin:0;font-size:12px;color:#8a8a8a;">${escapeHtml(branding.name)}</p>
            ${npwp}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
