// supabase/functions/process-payment/index.ts
// Wrapper sur RPC complete_order_with_payment.
// Capture les exceptions Postgres et les remappe en réponses HTTP propres.
// Logs Sentry server-side optionnel.
//
// Session 10: support multi-tender via `payments` field (array). Forwarded as
// p_payments to RPC v8. Legacy `payment` (single object) still accepted and
// forwarded as p_payment (RPC v8 wraps it into a single-element array → iso v7).
//
// Session 37 (DB-02): durable Postgres-backed rate-limit added (checkRateLimitDurable).
// Limit: 60 req/min per IP — 1 payment/second sustained, covers peak cashier throughput
// on a single terminal while blocking automated abuse or runaway retry loops.
// Fail-open on DB error (trade-off S19 DEV-S19-1.A-02).
//
// Session 37 (SEC-01): RPC bumped v10 → v11. Order-level discount fields are now
// forwarded (they were silently dropped before), and the manager PIN is read from
// the `x-manager-pin` header (S25 pattern — never in the JSON body) and relayed as
// p_manager_pin. The RPC validates discount authority (sales.discount) + PIN
// server-side whenever any discount is present.
//
// Session 44 (P0-A/P0-C): RPC bumped v11 → v12. The client no longer forwards a
// loyalty_multiplier (v12 resolves it server-side from tier × category). New
// check_violation gates surface as `promo_amount_mismatch` (server re-evaluates
// promotions) and `invalid_change` (change revalidated vs cash_received).
//
// Session 55 (T7): RPC bumped v15 → v16. `p_manager_pin` no longer exists on the
// RPC — the discount PIN is verified HERE (parity with void-order/cancel-item/
// refund-order, S25 pattern: PIN only ever travels via the `x-manager-pin`
// header). On a discount, the EF verifies the PIN, checks `sales.discount`, and
// mints a single-use nonce row in `discount_authorizations` (service-role only)
// forwarded as `p_discount_auth_id`; v16 consumes it atomically. The S38
// `record_pin_failure_v1` fallback (previously here to record failures the RPC
// itself couldn't durably persist) is gone — `recordManagerPinFailure` now does
// that job in-EF, in the same transaction as the verification.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { rateLimitedResponse } from '../_shared/responses.ts';
import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';
import { verifyManagerPin, isManagerPinBlocked, recordManagerPinFailure, MANAGER_PIN_FAIL_WINDOW_SEC } from '../_shared/manager-pin.ts';
import { checkPermissionForRole } from '../_shared/permissions.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_METHODS = new Set(['cash', 'card', 'qris', 'edc', 'transfer', 'store_credit']);
const MAX_TENDERS = 5;

type PaymentMethod = 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';

interface PaymentEntry {
  method: PaymentMethod;
  amount: number;
  cash_received?: number;
  change_given?: number;
  reference?: string;
}

interface ProcessPaymentPayload {
  session_id: string;
  order_type: 'dine_in' | 'take_out' | 'delivery';
  // Items are forwarded verbatim to the RPC (modifiers, combo_components, discount
  // fields ride along at runtime). S47: combo lines carry combo_components so v13
  // deducts each chosen component's stock instead of the virtual combo product.
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    combo_components?: Array<{ product_id: string; quantity: number }>;
  }>;
  /** Single-tender (legacy v7). Either `payment` or `payments` MUST be supplied (not both). */
  payment?: PaymentEntry;
  /** Multi-tender array (session 10 / RPC v8). Length 1..5. Sum(amounts) = final total. */
  payments?: PaymentEntry[];
  /**
   * Optional UUID v4 idempotency key (decision D8 of the session-1 addendum).
   * When the same key is replayed against this function, the underlying RPC
   * returns the existing order instead of creating a new one.
   */
  idempotency_key?: string;
  customer_id?: string;
  loyalty_points_redeemed?: number;
  /** Session 4: dine-in table name (e.g. "T-03"). Forwarded to RPC v4 as p_table_number. */
  table_number?: string;
  /**
   * Session 9: applied promotions (already evaluated client-side). Each entry
   * is `{promotion_id, amount, description, scope_line_id?}`. Forwarded to
   * RPC v7 as `p_promotions` ; the RPC re-validates eligibility server-side
   * and inserts `promotion_applications` rows.
   */
  promotions?: Array<{
    promotion_id: string;
    amount: number;
    description: string;
    scope_line_id?: string;
  }>;
  /**
   * Session 37 (SEC-01): order-level cart discount, produced by buildOrderPayload.
   * Forwarded to RPC v11 which enforces sales.discount authority + manager PIN
   * (PIN travels in the x-manager-pin header, not here).
   */
  discount_amount?: number;
  discount_type?: string;
  discount_value?: number;
  discount_reason?: string;
  discount_authorized_by?: string;
}

function isValidPaymentEntry(p: PaymentEntry | undefined): p is PaymentEntry {
  if (!p) return false;
  if (!VALID_METHODS.has(p.method)) return false;
  if (typeof p.amount !== 'number' || p.amount <= 0) return false;
  return true;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // S37 DB-02 — rate-limit MUST run before any header/body validation.
  // 60/min per IP: 1 payment/second sustained, covers peak cashier throughput
  // on a single terminal while blocking automated abuse. Fail-open on DB error.
  const ip = getClientIp(req);
  const rl = await checkRateLimitDurable({
    functionName: 'process-payment',
    bucketKey:    `ip:${ip}`,
    ipAddress:    ip,
    maxPerWindow: 60,
    windowSec:    60,
  });
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'authorization_required' }, 401);
  }

  let body: ProcessPaymentPayload;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body.session_id || !body.order_type || !Array.isArray(body.items) || body.items.length === 0) {
    return jsonResponse({ error: 'missing_or_invalid_fields' }, 400);
  }

  // Session 10 — exactly one of payment/payments. Validate per branch.
  const hasSingle = body.payment !== undefined;
  const hasArray  = Array.isArray(body.payments) && body.payments.length > 0;

  if (hasSingle && hasArray) {
    return jsonResponse({ error: 'cannot_supply_both_payment_and_payments' }, 400);
  }
  if (!hasSingle && !hasArray) {
    return jsonResponse({ error: 'missing_payment' }, 400);
  }

  if (hasSingle) {
    if (!isValidPaymentEntry(body.payment)) {
      return jsonResponse({ error: 'invalid_payment' }, 400);
    }
    if (body.payment!.method === 'cash') {
      if (typeof body.payment!.cash_received !== 'number' || body.payment!.cash_received < body.payment!.amount) {
        return jsonResponse({ error: 'cash_received_insufficient' }, 400);
      }
    }
  } else {
    const arr = body.payments!;
    if (arr.length > MAX_TENDERS) {
      return jsonResponse({ error: 'too_many_tenders', max: MAX_TENDERS }, 400);
    }
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]!;
      if (!isValidPaymentEntry(p)) {
        return jsonResponse({ error: 'invalid_tender', index: i }, 400);
      }
      // Cash overpay rule (SP2): only the LAST entry may overpay.
      if (
        p.method === 'cash'
        && typeof p.cash_received === 'number'
        && p.cash_received > p.amount
        && i < arr.length - 1
      ) {
        return jsonResponse({ error: 'intermediate_cash_overpay', index: i }, 400);
      }
    }
  }

  // Optional idempotency key — must be a UUID when provided.
  if (body.idempotency_key !== undefined && !UUID_REGEX.test(body.idempotency_key)) {
    return jsonResponse({ error: 'invalid_idempotency_key' }, 400);
  }

  // Use a per-request client carrying the user JWT so the RPC sees auth.uid()
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // S55 T7 — le PIN discount est vérifié ICI (parité void/cancel/refund) et ne
  // descend plus jamais dans un arg SQL de la money-path. Un nonce single-use
  // (discount_authorizations, service-role only) transporte l'autorisation
  // jusqu'à complete_order_with_payment_v16, qui le consomme atomiquement.
  const managerPin = req.headers.get('x-manager-pin');
  const hasDiscount = (typeof body.discount_amount === 'number' && body.discount_amount > 0)
    || body.items.some((i) => typeof (i as { discount_amount?: number }).discount_amount === 'number'
        && ((i as { discount_amount?: number }).discount_amount ?? 0) > 0);

  let discountAuthId: string | null = null;
  let discountAuthorizedBy: string | null = null;
  if (hasDiscount) {
    if (!managerPin || managerPin.trim().length === 0) {
      return jsonResponse({ error: 'permission_denied', message: 'Discount requires the manager PIN (x-manager-pin header)' }, 403);
    }
    if (await isManagerPinBlocked(ip)) {
      return rateLimitedResponse(MANAGER_PIN_FAIL_WINDOW_SEC);
    }
    const mgr = await verifyManagerPin(managerPin);
    if (!mgr.ok) {
      if (mgr.reason === 'invalid_pin_format') return jsonResponse({ error: 'invalid_pin_format' }, 400);
      if (mgr.reason === 'no_match') {
        const { blocked, retryAfterSec } = await recordManagerPinFailure(ip, 'process-payment');
        if (blocked) return rateLimitedResponse(retryAfterSec);
        return jsonResponse({ error: 'permission_denied', message: 'Invalid manager PIN for discount authorization' }, 403);
      }
      return jsonResponse({ error: 'internal' }, 500);
    }
    const allowed = await checkPermissionForRole(mgr.role_code, 'sales.discount', mgr.manager_profile_id);
    if (!allowed) {
      return jsonResponse({ error: 'permission_denied', message: 'Permission denied: sales.discount (authorizer)' }, 403);
    }
    // L'autorisation est DÉRIVÉE du PIN vérifié — le body client n'est plus cru.
    discountAuthorizedBy = mgr.manager_profile_id;
    const admin = getAdminClient();
    const { data: nonce, error: nonceErr } = await admin
      .from('discount_authorizations')
      .insert({ manager_profile_id: mgr.manager_profile_id })
      .select('id')
      .single();
    if (nonceErr || !nonce) {
      console.error('[process-payment] discount nonce mint failed', nonceErr);
      return jsonResponse({ error: 'internal' }, 500);
    }
    discountAuthId = nonce.id;
  }

  const { data, error } = await userClient.rpc('complete_order_with_payment_v16', {
    p_session_id: body.session_id,
    p_order_type: body.order_type,
    p_items: body.items,
    // v8: forward exactly one of p_payment / p_payments. RPC raises if both supplied.
    ...(hasSingle ? { p_payment: body.payment } : {}),
    ...(hasArray  ? { p_payments: body.payments } : {}),
    ...(body.idempotency_key ? { p_idempotency_key: body.idempotency_key } : {}),
    ...(body.customer_id ? { p_customer_id: body.customer_id } : {}),
    ...(body.loyalty_points_redeemed ? { p_loyalty_points_redeemed: body.loyalty_points_redeemed } : {}),
    ...(body.table_number ? { p_table_number: body.table_number } : {}),
    ...(body.promotions && body.promotions.length > 0 ? { p_promotions: body.promotions } : {}),
    // S37 SEC-01: forward the order-level discount (was silently dropped pre-v11).
    ...(typeof body.discount_amount === 'number' && body.discount_amount > 0
      ? {
          p_discount_amount: body.discount_amount,
          ...(body.discount_type ? { p_discount_type: body.discount_type } : {}),
          ...(typeof body.discount_value === 'number' ? { p_discount_value: body.discount_value } : {}),
          ...(body.discount_reason ? { p_discount_reason: body.discount_reason } : {}),
        }
      : {}),
    ...(discountAuthorizedBy
      ? { p_discount_authorized_by: discountAuthorizedBy }
      : (body.discount_authorized_by ? { p_discount_authorized_by: body.discount_authorized_by } : {})),
    ...(discountAuthId ? { p_discount_auth_id: discountAuthId } : {}),
  });

  if (error) {
    console.error('complete_order_with_payment error', error);
    // Map Postgres error codes
    if (error.code === 'P0001') {
      const msg = String(error.message ?? '');
      // v11 lève P0001 pour plusieurs gates distincts — différencie le gate
      // discount (audit 2026-06-12 P0-1) des autres P0001 (mappés no_open_session).
      // Contrat substring : matche le RAISE 'Discount requires an authorizing
      // manager (p_discount_authorized_by)' de 20260621000010 — garder en sync
      // à tout bump vN. TODO(v12): ERRCODE dédié et supprimer ce match.
      if (msg.includes('authorizing manager')) {
        return jsonResponse({ error: 'discount_requires_authorizer', message: msg }, 409);
      }
      return jsonResponse({ error: 'no_open_session', message: msg }, 409);
    }
    if (error.code === 'P0002') return jsonResponse({ error: 'insufficient_stock', message: error.message }, 409);
    if (error.code === 'P0003') return jsonResponse({ error: 'permission_denied', message: error.message }, 403);
    // S38 SEC-06 — manager account locked (5 failed PINs / 15 min).
    if (error.code === 'P0004') return jsonResponse({ error: 'account_locked', message: error.message }, 403);
    if (error.code === 'P0010') return jsonResponse({ error: 'insufficient_loyalty_points', message: error.message }, 409);
    if (error.code === '23514') {
      const msg = String(error.message ?? '');
      // S44 P0-C — v12 raises check_violation for the recomputed-promo and
      // change-amount gates ; surface dedicated codes (classifier → FR copy).
      if (msg.includes('Promotion amount mismatch')) {
        return jsonResponse({ error: 'promo_amount_mismatch', message: msg }, 409);
      }
      if (msg.includes('Invalid change amount')) {
        return jsonResponse({ error: 'invalid_change', message: msg }, 409);
      }
      return jsonResponse({ error: 'check_violation', message: error.message }, 422);
    }
    return jsonResponse({ error: 'internal', message: error.message }, 500);
  }

  return jsonResponse(data);
});
