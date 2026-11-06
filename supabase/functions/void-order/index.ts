// supabase/functions/void-order/index.ts
// Session 10 — manager-PIN-gated full void of a paid order.
// S34 security hardening (security-fraud-guard gaps 1 & 2):
//   - GAP 2: manager PIN moved from JSON body → `x-manager-pin` HTTP header
//     (bodies are logged; headers are not). Hard cutover, no body fallback.
//   - GAP 1: calls void_order_rpc_v2 (service_role-only) via the admin client,
//     passing the cashier's verified auth.uid as p_acting_auth_user_id. The old
//     void_order_rpc was directly callable via PostgREST by any authenticated
//     cashier, bypassing this PIN check entirely.
// S55 — idempotency: reads `x-idempotency-key` header, relays to the RPC.
// ADR-013 Lot 2 D1 — refuse le void si un refund partiel existe (23514 -> 422).
// ADR-013 Lot 3 — RPC bump v6 -> v7 (search_path durci) ; D15/M5 redaction :
// plus aucun `message` Postgres brut dans les réponses, fallthrough logAndRedact.
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
import { logAndRedact } from '../_shared/error-redact.ts';
import { withPermissionErrors } from '../_shared/permissions.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface VoidOrderPayload {
  source?: 'pos' | 'backoffice';
  session_id?: string | null;
  order_id: string;
  reason: string;
}

serve(withPermissionErrors(async (req) => {
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
  if (actingAuthUserId instanceof Response) return actingAuthUserId;
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
  if (await isManagerPinBlocked(ip, actingAuthUserId)) {
    return rateLimitedResponse(MANAGER_PIN_FAIL_WINDOW_SEC);
  }

  if ((body.source !== undefined && !['pos','backoffice'].includes(body.source))
    || (body.session_id != null && !UUID_REGEX.test(body.session_id))
    || (body.source === 'backoffice' && body.session_id != null)) {
    return jsonResponse({ error: 'invalid_refund_source' }, 400);
  }
  const mgr = await verifyManagerPin(managerPin);
  if (!mgr.ok) {
    if (mgr.reason === 'invalid_pin_format') return jsonResponse({ error: 'invalid_pin_format' }, 400);
    if (mgr.reason === 'no_match') {
      const { blocked, retryAfterSec } = await recordManagerPinFailure(ip, 'void-order', actingAuthUserId);
      if (blocked) return rateLimitedResponse(retryAfterSec);
      return jsonResponse({ error: 'wrong_pin' }, 401);
    }
    return jsonResponse({ error: 'internal_error' }, 500);
  }

  // service_role admin client — the only role allowed to EXECUTE the RPC.
  const admin = getAdminClient();
  const { data, error } = await admin.rpc('void_order_rpc_v14', {
    p_order_id:            body.order_id,
    p_reason:              body.reason,
    p_authorized_by:       mgr.manager_profile_id,
    p_acting_auth_user_id: actingAuthUserId,
    p_idempotency_key:     idempotencyKey,
    p_refund_source: body.source ?? null,
    p_session_id: body.session_id ?? null,
  });

  if (error) {
    // Log serveur complet ; réponses client sans message brut (ADR-013 D15/M5).
    console.error('[void-order] rpc error', error);
    if (error.code === 'P0001' && error.message?.includes('no_open_shift')) return jsonResponse({ error: 'no_open_shift' }, 422);
    if (error.code === 'P0001') return jsonResponse({ error: 'not_authenticated' }, 401);
    if (error.code === 'P0002') return jsonResponse({ error: 'not_found' }, 404);
    if (error.code === 'P0003') return jsonResponse({ error: 'permission_denied' }, 403);
    if (error.code === 'P0011') return jsonResponse({ error: 'cross_shift_not_allowed' }, 422);
    // Lot 6b (v10) — cross-shift : void refusé si un paiement cash existe.
    if (error.code === 'P0016') return jsonResponse({ error: 'cash_void_requires_open_session' }, 422);
    if (error.code === 'P0020') return jsonResponse({ error: 'loyalty_points_unavailable' }, 422);
    if (error.code === '23514' && error.message?.includes('outstanding_prior_day_requires_refund')) return jsonResponse({ error: 'outstanding_prior_day_requires_refund' }, 422);
    if (error.code === '23514') return jsonResponse({ error: 'check_violation' }, 422);
    return jsonResponse(logAndRedact('void-order', error.message ?? error), 500);
  }

  return jsonResponse({
    ...data,
    manager: { id: mgr.manager_profile_id, full_name: mgr.full_name, role_code: mgr.role_code },
  });
}));
