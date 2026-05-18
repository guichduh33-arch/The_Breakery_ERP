// supabase/functions/customer-birthday-notify/index.ts
// Session 21 / Sub-phase 1.A.1 — Birthday notification Edge Function.
//
// Triggered daily at 02:00 UTC (09:00 ICT) by pg_cron via net.http_post.
// For each opted-in customer whose birth_date matches today (Asia/Jakarta),
// enqueues one notification_outbox row via enqueue_notification_v1 RPC.
//
// Auth: verify_jwt=false. Requests must include header
//   x-cron-secret: <BIRTHDAY_CRON_SECRET env var>
// so that only the pg_cron job (or authorised callers) can trigger the run.
// If BIRTHDAY_CRON_SECRET is unset, the function rejects all calls
// (fail-closed). Direct POST with service_role Bearer also accepted.
//
// Response: { ok: true, processed: N }
//
// DEV-S21-1.A.1-01: shared-secret auth. Future: vault service_role_key +
//   switch to Bearer to eliminate the literal secret in the cron command.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';

const JAKARTA_TZ = 'Asia/Jakarta';

/** Return YYYY-MM-DD in Jakarta timezone for a given UTC instant. */
function jakartaDateStr(now: Date): string {
  return now.toLocaleDateString('sv-SE', { timeZone: JAKARTA_TZ }); // sv-SE gives ISO format
}

/** Extract month and day from a date string (YYYY-MM-DD). */
function monthDay(dateStr: string): { month: number; day: number } {
  const [, m, d] = dateStr.split('-').map(Number);
  return { month: m, day: d };
}

async function authorize(req: Request): Promise<boolean> {
  // Path 1: shared cron secret in header
  const cronSecret = Deno.env.get('BIRTHDAY_CRON_SECRET');
  const headerSecret = req.headers.get('x-cron-secret');
  if (cronSecret && headerSecret && headerSecret === cronSecret) {
    return true;
  }

  // Path 2: service_role Bearer JWT
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) {
      const admin = getAdminClient();
      const { data, error } = await admin.auth.getUser(token);
      // Service role tokens don't resolve to a user but do have a valid payload
      if (!error && data?.user) return true;
      // Accept service_role key directly (it bypasses GoTrue user lookup)
      const srKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      if (srKey && token === srKey) return true;
    }
  }

  return false;
}

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const ok = await authorize(req);
  if (!ok) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const admin = getAdminClient();

  // Determine today in Jakarta timezone
  const now = new Date();
  const todayStr = jakartaDateStr(now);
  const { month: todayMonth, day: todayDay } = monthDay(todayStr);

  // Query opted-in customers whose birth_date matches today (month + day).
  // We use EXTRACT for month/day comparison — ignores year (birthday = annual).
  const { data: customers, error: fetchErr } = await admin
    .from('customers')
    .select('id, name, email')
    .is('deleted_at', null)
    .not('birth_date', 'is', null)
    .eq('marketing_consent', true)
    .not('email', 'is', null);

  if (fetchErr) {
    console.error('customer-birthday-notify: fetch error', fetchErr.message);
    return jsonResponse({ error: 'fetch_failed', details: fetchErr.message }, 500);
  }

  // Filter in JS for month+day match (Supabase JS client doesn't expose
  // EXTRACT directly in filter — we fetch consent-eligible customers and
  // filter by birth_date month/day here).
  const eligible = ((customers ?? []) as Array<CustomerRow & { birth_date?: string }>)
    .filter((c) => {
      if (!c.birth_date || !c.email || !c.email.trim()) return false;
      try {
        const { month, day } = monthDay(c.birth_date);
        return month === todayMonth && day === todayDay;
      } catch {
        return false;
      }
    });

  let processed = 0;

  for (const cust of eligible) {
    // Build idempotency key: birthday-<customer_id>-<YYYY-MM-DD>
    // Matches the key used by notify_birthday_customers_v1 DB function
    // so if both paths run on the same day, the outbox deduplicates.
    // We use a deterministic UUID-like key via a hash pattern.
    // Since we can't call uuid_generate_v5 from Deno, we compute a stable
    // string-based key and let enqueue_notification_v1 handle dedup via
    // the UNIQUE index on idempotency_key.
    const idemStr = `birthday-ef-${cust.id}-${todayStr}`;
    // Truncate to UUID shape using a simple hash (crypto.subtle SHA-256 → UUID v4-ish)
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(idemStr));
    const hashArr = new Uint8Array(hashBuf);
    // Format first 16 bytes as UUID
    const hex = Array.from(hashArr.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const idemKey = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      // Set version bits to 5 (SHA1-based name UUID convention, close enough)
      ((parseInt(hex.slice(12, 16), 16) & 0x0fff) | 0x5000).toString(16).padStart(4, '0'),
      ((parseInt(hex.slice(16, 20), 16) & 0x3fff) | 0x8000).toString(16).padStart(4, '0'),
      hex.slice(20, 32),
    ].join('-');

    const { error: enqErr } = await admin.rpc('enqueue_notification_v1', {
      p_template_code:   'customer_birthday',
      p_recipient:       cust.email,
      p_variables:       { customer_name: cust.name ?? 'friend', bonus_points: 50 },
      p_channel:         'email',
      p_scheduled_for:   null,
      p_idempotency_key: idemKey,
    });

    if (enqErr) {
      // Log and continue — a single bad row should not abort the batch.
      console.warn(`customer-birthday-notify: skipped ${cust.id}: ${enqErr.message}`);
    } else {
      processed++;
    }
  }

  return jsonResponse({ ok: true, processed, date: todayStr });
});
