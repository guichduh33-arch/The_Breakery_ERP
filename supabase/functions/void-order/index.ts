// supabase/functions/void-order/index.ts
// Session 10 — manager-PIN-gated full void of a paid order.
// S34 security hardening (security-fraud-guard gaps 1 & 2):
//   - GAP 2: manager PIN moved from JSON body → `x-manager-pin` HTTP header
//     (bodies are logged; headers are not). Hard cutover, no body fallback.
//   - GAP 1: calls void_order_rpc_v2 (service_role-only) via the admin client,
//     passing the cashier's verified auth.uid as p_acting_auth_user_id. The old
//     void_order_rpc was directly callable via PostgREST by any authenticated
//     cashier, bypassing this PIN check entirely.
// S55 — idempotency: reads `x-idempotency-key` header, relays to void_order_rpc_v5.
//
// Headers:
//   x-manager-pin:     string (6 digits) — REQUIRED
//   x-idempotency-key: UUID v4 — OPTIONAL (enables replay-safe retries)
// Body: { order_id: UUID, reason: string (>=3) }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { verifyManagerPin, isManagerPinBlocked, recordManagerPinFailure, MANAGER_PIN_FAIL_WINDOW_SEC } from '../_shared/manager-pin.ts';
import { getIdempotencyKey, InvalidIdempotencyKeyError } from '../_shared/idempotency.ts';
import { getActingAuthUserId } from '../_shared/acting-user.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface VoidOrderPayload {
  order_id: string;
  reason: string;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'void-order',
    bucketKey:    `ip:${ip}`,
    ipAddress:    ip,
    maxPerWindow: 10,
    windowSec:    60,
  });
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  // GAP 2 — manager PIN from header, never the body.
  const managerPin = req.headers.get('x-manager-pin');
  if (!managerPin || managerPin.trim().length === 0) {
    return jsonResponse({ error: 'missing_manager_pin' }, 400);
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'authorization_required' }, 401);
  }

  // GAP 1 — resolve the acting cashier server-side (RPC is service_role-only now).
  const actingAuthUserId = await getActingAuthUserId(req);
  if (!actingAuthUserId) {
    return jsonResponse({ error: 'not_authenticated' }, 401);
  }

  let body: VoidOrderPayload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  let idempotencyKey: string | null = null;
  try {
    idempotencyKey = getIdempotencyKey(req);
  } catch (e) {
    if (e instanceof InvalidIdempotencyKeyError) {
      return jsonResponse({ error: 'invalid_idempotency_key' }, 400);
    }
    throw e;
  }

  if (!body.order_id || !UUID_REGEX.test(body.order_id)) {
    return jsonResponse({ error: 'invalid_order_id' }, 400);
  }
  if (!body.reason || body.reason.trim().length < 3) {
    return jsonResponse({ error: 'reason_too_short' }, 400);
  }

  // SEC-07 — check fail bucket before attempting PIN verification.
  if (await isManagerPinBlocked(ip)) {
    return rateLimitedResponse(MANAGER_PIN_FAIL_WINDOW_SEC);
  }

  const mgr = await verifyManagerPin(managerPin);
  if (!mgr.ok) {
    if (mgr.reason === 'invalid_pin_format') return jsonResponse({ error: 'invalid_pin_format' }, 400);
    if (mgr.reason === 'no_match') {
      const { blocked, retryAfterSec } = await recordManagerPinFailure(ip, 'void-order');
      if (blocked) return rateLimitedResponse(retryAfterSec);
      return jsonResponse({ error: 'wrong_pin' }, 401);
    }
    return jsonResponse({ error: 'internal' }, 500);
  }

  // service_role admin client — the only role allowed to EXECUTE the v5 RPC.
  const admin = getAdminClient();
  const { data, error } = await admin.rpc('void_order_rpc_v5', {
    p_order_id:            body.order_id,
    p_reason:              body.reason,
    p_authorized_by:       mgr.manager_profile_id,
    p_acting_auth_user_id: actingAuthUserId,
    p_idempotency_key:     idempotencyKey,
  });

  if (error) {
    console.error('[void-order] rpc error', error);
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
