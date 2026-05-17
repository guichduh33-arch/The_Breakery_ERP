// supabase/functions/refund-order/index.ts
// Session 10 — manager-PIN-gated partial line refund. Calls refund_order_rpc.
//
// Body: {
//   order_id: UUID,
//   lines: [{order_item_id: UUID, qty: number}],
//   tenders: [{method: payment_method, amount: number, reference?: string}],
//   reason: string (>=3),
//   manager_pin: string (6 digits)
// }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { verifyManagerPin } from '../_shared/manager-pin.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_METHODS = ['cash', 'card', 'qris', 'edc', 'transfer', 'store_credit'];

interface RefundOrderPayload {
  order_id: string;
  lines: Array<{ order_item_id: string; qty: number }>;
  tenders: Array<{ method: string; amount: number; reference?: string }>;
  reason: string;
  manager_pin: string;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'refund-order',
    bucketKey:    `ip:${ip}`,
    ipAddress:    ip,
    maxPerWindow: 10,
    windowSec:    60,
  });
  if (!rl.allowed) return jsonResponse({ error: 'rate_limited', retry_after_sec: rl.retryAfterSec }, 429);

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'authorization_required' }, 401);
  }

  let body: RefundOrderPayload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body.order_id || !UUID_REGEX.test(body.order_id)) {
    return jsonResponse({ error: 'invalid_order_id' }, 400);
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return jsonResponse({ error: 'no_lines' }, 400);
  }
  for (const ln of body.lines) {
    if (!UUID_REGEX.test(ln.order_item_id) || typeof ln.qty !== 'number' || ln.qty <= 0) {
      return jsonResponse({ error: 'invalid_line', message: JSON.stringify(ln) }, 400);
    }
  }
  if (!Array.isArray(body.tenders) || body.tenders.length === 0) {
    return jsonResponse({ error: 'no_tenders' }, 400);
  }
  for (const t of body.tenders) {
    if (!VALID_METHODS.includes(t.method) || typeof t.amount !== 'number' || t.amount <= 0) {
      return jsonResponse({ error: 'invalid_tender', message: JSON.stringify(t) }, 400);
    }
  }
  if (!body.reason || body.reason.trim().length < 3) {
    return jsonResponse({ error: 'reason_too_short' }, 400);
  }
  if (!body.manager_pin || typeof body.manager_pin !== 'string') {
    return jsonResponse({ error: 'missing_manager_pin' }, 400);
  }

  const mgr = await verifyManagerPin(body.manager_pin);
  if (!mgr.ok) {
    if (mgr.reason === 'invalid_pin_format') return jsonResponse({ error: 'invalid_pin_format' }, 400);
    if (mgr.reason === 'no_match') return jsonResponse({ error: 'wrong_pin' }, 401);
    return jsonResponse({ error: 'internal' }, 500);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return jsonResponse({ error: 'server_misconfigured' }, 500);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await userClient.rpc('refund_order_rpc_v2', {
    p_order_id: body.order_id,
    p_lines: body.lines,
    p_tenders: body.tenders,
    p_reason: body.reason,
    p_authorized_by: mgr.manager_profile_id,
  });

  if (error) {
    console.error('[refund-order] rpc error', error);
    if (error.code === 'P0001') return jsonResponse({ error: 'not_authenticated', message: error.message }, 401);
    if (error.code === 'P0002') return jsonResponse({ error: 'not_found', message: error.message }, 404);
    if (error.code === 'P0003') return jsonResponse({ error: 'permission_denied', message: error.message }, 403);
    if (error.code === 'P0011') return jsonResponse({ error: 'cross_shift_not_allowed', message: error.message }, 422);
    if (error.code === '23514') return jsonResponse({ error: 'check_violation', message: error.message }, 422);
    return jsonResponse({ error: 'internal', message: error.message }, 500);
  }

  return jsonResponse({
    ...data,
    manager: { id: mgr.manager_profile_id, full_name: mgr.full_name, role_code: mgr.role_code },
  });
});
