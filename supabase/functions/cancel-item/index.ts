// supabase/functions/cancel-item/index.ts
// Session 10 — manager-PIN-gated cancel of an order_item that has been sent
// to the kitchen. Calls cancel_order_item_rpc and returns the recomputed totals.
//
// Body: { order_item_id: UUID, reason: string (>=3), manager_pin: string (6 digits) }
//
// The cashier's user JWT (Bearer header) authenticates the request to Postgres
// (so RLS sees the cashier's auth.uid()). The manager_pin resolves to a
// manager profile_id which is passed as p_authorized_by to the RPC.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { verifyManagerPin } from '../_shared/manager-pin.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CancelItemPayload {
  order_item_id: string;
  reason: string;
  manager_pin: string;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'cancel-item',
    bucketKey:    `ip:${ip}`,
    ipAddress:    ip,
    maxPerWindow: 10,
    windowSec:    60,
  });
  // S22 / 1.B.2 — DEV-S19-2.A-02 : surface Retry-After header alongside body.
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'authorization_required' }, 401);
  }

  let body: CancelItemPayload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body.order_item_id || !UUID_REGEX.test(body.order_item_id)) {
    return jsonResponse({ error: 'invalid_order_item_id' }, 400);
  }
  if (!body.reason || body.reason.trim().length < 3) {
    return jsonResponse({ error: 'reason_too_short' }, 400);
  }
  if (!body.manager_pin || typeof body.manager_pin !== 'string') {
    return jsonResponse({ error: 'missing_manager_pin' }, 400);
  }

  // Verify manager PIN → resolve manager profile_id
  const mgr = await verifyManagerPin(body.manager_pin);
  if (!mgr.ok) {
    if (mgr.reason === 'invalid_pin_format') return jsonResponse({ error: 'invalid_pin_format' }, 400);
    if (mgr.reason === 'no_match') return jsonResponse({ error: 'wrong_pin' }, 401);
    return jsonResponse({ error: 'internal' }, 500);
  }

  // Per-request user client carrying cashier JWT
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return jsonResponse({ error: 'server_misconfigured' }, 500);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await userClient.rpc('cancel_order_item_rpc', {
    p_order_item_id: body.order_item_id,
    p_reason: body.reason,
    p_authorized_by: mgr.manager_profile_id,
  });

  if (error) {
    console.error('[cancel-item] rpc error', error);
    if (error.code === 'P0001') return jsonResponse({ error: 'not_authenticated', message: error.message }, 401);
    if (error.code === 'P0002') return jsonResponse({ error: 'not_found', message: error.message }, 404);
    if (error.code === 'P0003') return jsonResponse({ error: 'permission_denied', message: error.message }, 403);
    if (error.code === '23514') return jsonResponse({ error: 'check_violation', message: error.message }, 422);
    return jsonResponse({ error: 'internal', message: error.message }, 500);
  }

  return jsonResponse({
    ...data,
    manager: { id: mgr.manager_profile_id, full_name: mgr.full_name, role_code: mgr.role_code },
  });
});
