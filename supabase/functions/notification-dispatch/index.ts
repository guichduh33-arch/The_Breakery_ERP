// supabase/functions/notification-dispatch/index.ts
// Session 13 / Phase 5.B — Notifications pipeline dispatcher.
//
// Polls `notification_outbox` for rows in status IN ('queued','retry')
// scheduled for now-or-earlier, processes up to 50 rows per invocation,
// routes by channel (v1 = email only via Resend), updates the row
// status to 'sent' / 'retry' / 'failed' based on the provider result.
//
// Retry strategy : exponential backoff 2^retries minutes, max 3 retries.
//
// Authentication :
//   - Bearer JWT with `notifications.send` perm (manager+) — primary
//     pathway for app-side manual flushes.
//   - `x-dispatch-secret: <NOTIFICATION_DISPATCH_SECRET>` HTTP header — for
//     scheduled invocations (Vercel Cron, GitHub Action, manual curl).
//     If `NOTIFICATION_DISPATCH_SECRET` env var is unset, this pathway
//     is disabled (Bearer-only).
//     S50 V2a-i T6 — moved off the `?secret=` query param: query strings get
//     logged by CDNs / load balancers / the Supabase dashboard, leaking the
//     shared secret. Headers are far less commonly captured. Hard cutover —
//     external schedulers must send the header (no query fallback).
//
// Channels v1 :
//   - email  : Resend (or console mode if RESEND_API_KEY unset). See
//              _shared/email-provider.ts.
//   - sms/push/inapp : not yet implemented — outbox row is marked
//              `failed` with error_message='channel_not_implemented'.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { sendEmail, type SendEmailResult } from '../_shared/email-provider.ts';

const MAX_BATCH = 50;
const MAX_RETRIES = 3;

interface OutboxRow {
  id: string;
  template_code: string;
  channel: 'email' | 'sms' | 'push' | 'inapp';
  recipient: string;
  subject: string | null;
  body: string;
  status: string;
  retries: number;
  scheduled_for: string;
}

interface DispatchSummary {
  processed: number;
  sent: number;
  failed: number;
  retried: number;
  mode: 'resend' | 'console' | 'mixed';
}

function computeBackoffMinutes(nextRetries: number): number {
  // 2^1 = 2, 2^2 = 4, 2^3 = 8 minutes.
  return Math.min(2 ** nextRetries, 60);
}

async function authorize(req: Request): Promise<{ ok: boolean; reason?: string }> {
  // S50 V2a-i T6 — read the shared secret from a header (not the query string,
  // which leaks into access logs / CDN logs / the dashboard).
  const headerSecret = req.headers.get('x-dispatch-secret');
  const envSecret    = Deno.env.get('NOTIFICATION_DISPATCH_SECRET');

  if (envSecret && headerSecret && headerSecret === envSecret) {
    return { ok: true };
  }

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { ok: false, reason: 'missing_authorization' };
  }
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return { ok: false, reason: 'empty_token' };

  // Validate the bearer token by asking GoTrue who it belongs to.
  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, reason: 'invalid_token' };
  }

  // Check has_permission via RPC (service_role bypass — but we still
  // gate on the caller's identity).
  const { data: hasPerm, error: permErr } = await admin.rpc('has_permission', {
    p_uid:  data.user.id,
    p_perm: 'notifications.send',
  });
  if (permErr) return { ok: false, reason: `perm_check_error: ${permErr.message}` };
  if (!hasPerm) return { ok: false, reason: 'permission_denied' };

  return { ok: true };
}

async function processRow(row: OutboxRow): Promise<{
  newStatus: 'sent' | 'failed' | 'retry';
  errorMessage: string | null;
  providerMessageId: string | null;
  mode: 'resend' | 'console' | 'n/a';
}> {
  if (row.channel !== 'email') {
    return {
      newStatus: 'failed',
      errorMessage: 'channel_not_implemented',
      providerMessageId: null,
      mode: 'n/a',
    };
  }

  let result: SendEmailResult;
  try {
    result = await sendEmail({
      to:      row.recipient,
      subject: row.subject ?? '',
      body:    row.body,
    });
  } catch (err) {
    result = {
      ok: false,
      error: `dispatch_exception: ${(err as Error).message ?? String(err)}`,
      mode: 'resend',
    };
  }

  if (result.ok) {
    return {
      newStatus: 'sent',
      errorMessage: null,
      providerMessageId: result.providerMessageId ?? null,
      mode: result.mode,
    };
  }

  // Failed : decide retry vs final failure.
  const nextRetries = row.retries + 1;
  if (nextRetries <= MAX_RETRIES) {
    return {
      newStatus: 'retry',
      errorMessage: result.error ?? 'unknown_error',
      providerMessageId: null,
      mode: result.mode,
    };
  }
  return {
    newStatus: 'failed',
    errorMessage: result.error ?? 'unknown_error',
    providerMessageId: null,
    mode: result.mode,
  };
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const auth = await authorize(req);
  if (!auth.ok) {
    return jsonResponse({ error: 'unauthorized', reason: auth.reason }, 401);
  }

  const admin = getAdminClient();

  // 1. Pick up the next batch atomically. We use a CTE-based UPDATE so
  //    the rows are marked 'sending' in a single transaction, avoiding
  //    races between concurrent dispatcher invocations.
  const { data: claimed, error: claimErr } = await admin.rpc(
    'pick_notifications_batch_v1',
    { p_limit: MAX_BATCH },
  );

  if (claimErr) {
    // Fallback path if the RPC is missing (older deploys) : select rows
    // and update them in two steps. Less safe under concurrency but
    // good enough for v1 single-cron.
    if (claimErr.code === '42883' || (claimErr.message ?? '').includes('does not exist')) {
      return await fallbackDispatch(req);
    }
    return jsonResponse({ error: 'claim_failed', details: claimErr.message }, 500);
  }

  const rows = (claimed ?? []) as OutboxRow[];
  if (rows.length === 0) {
    return jsonResponse({ processed: 0, sent: 0, failed: 0, retried: 0, mode: 'console' });
  }

  const summary: DispatchSummary = { processed: 0, sent: 0, failed: 0, retried: 0, mode: 'console' };
  const modes = new Set<'resend' | 'console'>();

  for (const row of rows) {
    summary.processed++;
    const outcome = await processRow(row);

    if (outcome.mode === 'resend' || outcome.mode === 'console') {
      modes.add(outcome.mode);
    }

    const update: Record<string, unknown> = {
      status:              outcome.newStatus,
      error_message:       outcome.errorMessage,
      provider_message_id: outcome.providerMessageId,
    };
    if (outcome.newStatus === 'sent') {
      update.sent_at = new Date().toISOString();
      summary.sent++;
    } else if (outcome.newStatus === 'retry') {
      update.retries = row.retries + 1;
      update.scheduled_for = new Date(
        Date.now() + computeBackoffMinutes(row.retries + 1) * 60_000,
      ).toISOString();
      summary.retried++;
    } else {
      summary.failed++;
    }

    await admin.from('notification_outbox').update(update).eq('id', row.id);
  }

  summary.mode = modes.size === 1
    ? ([...modes][0])
    : (modes.size > 1 ? 'mixed' : 'console');

  return jsonResponse(summary);
});

async function fallbackDispatch(_req: Request): Promise<Response> {
  // Two-step fallback when `pick_notifications_batch_v1` does not exist.
  // Not race-safe ; only used during the bootstrap window before the
  // RPC ships.
  const admin = getAdminClient();
  const { data: rows, error } = await admin
    .from('notification_outbox')
    .select('id, template_code, channel, recipient, subject, body, status, retries, scheduled_for')
    .in('status', ['queued', 'retry'])
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    return jsonResponse({ error: 'fallback_select_failed', details: error.message }, 500);
  }

  const summary: DispatchSummary = { processed: 0, sent: 0, failed: 0, retried: 0, mode: 'console' };
  const modes = new Set<'resend' | 'console'>();

  for (const row of (rows ?? []) as OutboxRow[]) {
    // Mark sending.
    await admin.from('notification_outbox').update({ status: 'sending' }).eq('id', row.id);

    summary.processed++;
    const outcome = await processRow(row);
    if (outcome.mode === 'resend' || outcome.mode === 'console') modes.add(outcome.mode);

    const update: Record<string, unknown> = {
      status:              outcome.newStatus,
      error_message:       outcome.errorMessage,
      provider_message_id: outcome.providerMessageId,
    };
    if (outcome.newStatus === 'sent') {
      update.sent_at = new Date().toISOString();
      summary.sent++;
    } else if (outcome.newStatus === 'retry') {
      update.retries = row.retries + 1;
      update.scheduled_for = new Date(
        Date.now() + computeBackoffMinutes(row.retries + 1) * 60_000,
      ).toISOString();
      summary.retried++;
    } else {
      summary.failed++;
    }
    await admin.from('notification_outbox').update(update).eq('id', row.id);
  }

  summary.mode = modes.size === 1 ? ([...modes][0]) : (modes.size > 1 ? 'mixed' : 'console');
  return jsonResponse(summary);
}
