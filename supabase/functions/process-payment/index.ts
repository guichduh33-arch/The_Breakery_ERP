// supabase/functions/process-payment/index.ts
// Wrapper sur RPC complete_order_with_payment.
// Capture les exceptions Postgres et les remappe en réponses HTTP propres.
// Logs Sentry server-side optionnel.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProcessPaymentPayload {
  session_id: string;
  order_type: 'dine_in' | 'take_out' | 'delivery';
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  payment: {
    method: 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';
    amount: number;
    cash_received?: number;
    change_given?: number;
  };
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
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

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

  if (!body.session_id || !body.order_type || !Array.isArray(body.items) || body.items.length === 0 || !body.payment) {
    return jsonResponse({ error: 'missing_or_invalid_fields' }, 400);
  }

  if (body.payment.method === 'cash') {
    if (typeof body.payment.cash_received !== 'number' || body.payment.cash_received < body.payment.amount) {
      return jsonResponse({ error: 'cash_received_insufficient' }, 400);
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

  const { data, error } = await userClient.rpc('complete_order_with_payment', {
    p_session_id: body.session_id,
    p_order_type: body.order_type,
    p_items: body.items,
    p_payment: body.payment,
    // Forward optional idempotency key — RPC stores/returns existing order on replay (D8)
    ...(body.idempotency_key ? { p_idempotency_key: body.idempotency_key } : {}),
    // Forward optional customer + loyalty redemption (session 3)
    ...(body.customer_id ? { p_customer_id: body.customer_id } : {}),
    ...(body.loyalty_points_redeemed ? { p_loyalty_points_redeemed: body.loyalty_points_redeemed } : {}),
    // Forward optional table_number (session 4 — RPC v4)
    ...(body.table_number ? { p_table_number: body.table_number } : {}),
  });

  if (error) {
    console.error('complete_order_with_payment error', error);
    // Map Postgres error codes
    if (error.code === 'P0001') return jsonResponse({ error: 'no_open_session', message: error.message }, 409);
    if (error.code === 'P0002') return jsonResponse({ error: 'insufficient_stock', message: error.message }, 409);
    if (error.code === 'P0003') return jsonResponse({ error: 'permission_denied', message: error.message }, 403);
    if (error.code === 'P0010') return jsonResponse({ error: 'insufficient_loyalty_points', message: error.message }, 409);
    return jsonResponse({ error: 'internal', message: error.message }, 500);
  }

  return jsonResponse(data);
});
