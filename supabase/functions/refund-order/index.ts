// supabase/functions/refund-order/index.ts
// Session 10 — manager-PIN-gated partial line refund. Calls refund_order_rpc
// (version courante : voir le call-site .rpc() ci-dessous — les commentaires
// historiques mentent, le call-site fait foi).
// Session 25 — PIN sent via `x-manager-pin` header (hard cutover, no body field).
//              `x-idempotency-key` header propagated to RPC for replay safety.
// S34 security hardening (security-fraud-guard gap 1):
//   - service_role-only RPC called via the admin client, passing the cashier's
//     verified auth.uid as p_acting_auth_user_id (direct PostgREST bypass closed).
// ADR-013 Lot 3 (D15/M5) — redaction : plus aucun `message` brut (Postgres ou
// echo d'input) dans les réponses ; fallthrough 500 via logAndRedact.
//
// Headers:
//   x-manager-pin:     string (6 digits) — REQUIRED
//   x-idempotency-key: UUID v4 — OPTIONAL (enables replay-safe retries)
//
// Body: {
//   order_id: UUID,
//   lines: [{order_item_id: UUID, qty: number}],
//   tenders: [{method: payment_method, amount: number, reference?: string}],
//   reason: string (>=3)
// }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { verifyManagerPin, isManagerPinBlocked, recordManagerPinFailure, MANAGER_PIN_FAIL_WINDOW_SEC } from '../_shared/manager-pin.ts';
import { getIdempotencyKey, InvalidIdempotencyKeyError } from '../_shared/idempotency.ts';
import { getActingAuthUserId } from '../_shared/acting-user.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { logAndRedact } from '../_shared/error-redact.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// gopay/ovo/dana : lot B ADR-006 déc. 9 (enum _207) — settlement type QRIS.
const VALID_METHODS = ['cash', 'card', 'qris', 'edc', 'transfer', 'store_credit', 'gopay', 'ovo', 'dana'];

interface RefundOrderPayload {
  order_id: string;
  lines: Array<{ order_item_id: string; qty: number }>;
  tenders: Array<{ method: string; amount: number; reference?: string }>;
  reason: string;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  // S25 CR fix — rate-limit MUST run before any header/body validation.
  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'refund-order',
    bucketKey:    `ip:${ip}`,
    ipAddress:    ip,
    maxPerWindow: 10,
    windowSec:    60,
  });
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  const managerPin = req.headers.get('x-manager-pin');
  if (!managerPin || managerPin.trim().length === 0) {
    return jsonResponse({ error: 'missing_manager_pin' }, 400);
  }

  let idempotencyKey: string | null = null;
  try {
    idempotencyKey = getIdempotencyKey(req);
  } catch (err) {
    if (err instanceof InvalidIdempotencyKeyError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    throw err;
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
  for (let i = 0; i < body.lines.length; i++) {
    const ln = body.lines[i]!;
    if (!UUID_REGEX.test(ln.order_item_id) || typeof ln.qty !== 'number' || ln.qty <= 0) {
      return jsonResponse({ error: 'invalid_line', index: i }, 400);
    }
  }
  if (!Array.isArray(body.tenders) || body.tenders.length === 0) {
    return jsonResponse({ error: 'no_tenders' }, 400);
  }
  for (let i = 0; i < body.tenders.length; i++) {
    const t = body.tenders[i]!;
    if (!VALID_METHODS.includes(t.method) || typeof t.amount !== 'number' || t.amount <= 0) {
      return jsonResponse({ error: 'invalid_tender', index: i }, 400);
    }
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
      const { blocked, retryAfterSec } = await recordManagerPinFailure(ip, 'refund-order');
      if (blocked) return rateLimitedResponse(retryAfterSec);
      return jsonResponse({ error: 'wrong_pin' }, 401);
    }
    return jsonResponse({ error: 'internal_error' }, 500);
  }

  // service_role admin client — the only role allowed to EXECUTE the RPC.
  const admin = getAdminClient();
  const { data, error } = await admin.rpc('refund_order_rpc_v10', {
    p_order_id:            body.order_id,
    p_lines:               body.lines,
    p_tenders:             body.tenders,
    p_reason:              body.reason,
    p_authorized_by:       mgr.manager_profile_id,
    p_idempotency_key:     idempotencyKey,
    p_acting_auth_user_id: actingAuthUserId,
  });

  if (error) {
    // Log serveur complet ; réponses client sans message brut (ADR-013 D15/M5).
    console.error('[refund-order] rpc error', error);
    if (error.code === 'P0001') return jsonResponse({ error: 'not_authenticated' }, 401);
    if (error.code === 'P0002') return jsonResponse({ error: 'not_found' }, 404);
    if (error.code === 'P0003') return jsonResponse({ error: 'permission_denied' }, 403);
    if (error.code === 'P0011') return jsonResponse({ error: 'cross_shift_not_allowed' }, 422);
    // ADR-013 Lot 4 (D6) — refund en avoir : client rattaché requis (v8).
    if (error.code === 'P0015') return jsonResponse({ error: 'store_credit_requires_customer' }, 422);
    // Lot 6b (v10) — cross-shift : le cash exige une session ouverte.
    if (error.code === 'P0016') return jsonResponse({ error: 'cash_refund_requires_open_session' }, 422);
    if (error.code === '23514') return jsonResponse({ error: 'check_violation' }, 422);
    return jsonResponse(logAndRedact('refund-order', error.message ?? error), 500);
  }

  if (data?.idempotent_replay === true) {
    // Audit the replay. actor = approving manager (matches v3 actor semantics).
    const { error: auditErr } = await admin.from('audit_logs').insert({
      actor_id:    mgr.manager_profile_id,
      action:      'refund.replay',
      entity_type: 'orders',
      entity_id:   body.order_id,
      metadata: {
        idempotency_key:   idempotencyKey,
        refund_id:         data.refund_id,
        acting_cashier_id: actingAuthUserId,
      },
    });
    if (auditErr) {
      console.warn('[refund-order] audit_logs insert failed', auditErr);
    }
  }

  return jsonResponse({
    ...data,
    manager: { id: mgr.manager_profile_id, full_name: mgr.full_name, role_code: mgr.role_code },
  });
});
