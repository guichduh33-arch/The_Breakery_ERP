// supabase/functions/_shared/email-provider.ts
// Session 13 / Phase 5.B — Notifications pipeline.
//
// Email provider abstraction. v1 supports two modes :
//   1. `resend` — calls https://api.resend.com/emails when
//      RESEND_API_KEY is set and is NOT a `re_test_` test key.
//   2. `console` — logs the message to stdout and returns
//      a synthetic providerMessageId. Used when the API key is
//      missing or starts with `re_test_`. Local-dev + CI use this.
//
// To switch to Sendgrid : replace `callResend()` with a Sendgrid
// equivalent. The exported `sendEmail()` signature stays stable.
//
// Required env vars for live mode :
//   - RESEND_API_KEY        (required for live mode)
//   - RESEND_FROM_ADDRESS   (optional ; defaults to onboarding@resend.dev)
//
// Returns :
//   { ok: boolean ; providerMessageId? ; error? ; mode: 'resend'|'console' }

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  from?: string;
}

export interface SendEmailResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  mode: 'resend' | 'console';
}

const DEFAULT_FROM = 'The Breakery <onboarding@resend.dev>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function isLive(apiKey: string | undefined): apiKey is string {
  if (!apiKey) return false;
  if (apiKey.startsWith('re_test_')) return false;
  return apiKey.startsWith('re_');
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from   = input.from
    ?? Deno.env.get('RESEND_FROM_ADDRESS')
    ?? DEFAULT_FROM;

  if (!isLive(apiKey)) {
    // Console mode — no network call. Stdout is visible in
    // `supabase functions logs notification-dispatch` and in the
    // staging dashboard. Useful for dev + CI.
    const stubId = `console-${crypto.randomUUID()}`;
    console.log(JSON.stringify({
      level: 'info',
      provider: 'console',
      providerMessageId: stubId,
      to: input.to,
      from,
      subject: input.subject,
      bodyPreview: input.body.slice(0, 200),
    }));
    return { ok: true, providerMessageId: stubId, mode: 'console' };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from,
        to:      [input.to],
        subject: input.subject,
        text:    input.body,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `resend_http_${res.status}: ${text.slice(0, 300)}`,
        mode: 'resend',
      };
    }

    const payload = await res.json().catch(() => ({}));
    const id = (payload as { id?: string }).id;
    return {
      ok: true,
      providerMessageId: id,
      mode: 'resend',
    };
  } catch (err) {
    return {
      ok: false,
      error: `resend_exception: ${(err as Error).message ?? String(err)}`,
      mode: 'resend',
    };
  }
}
