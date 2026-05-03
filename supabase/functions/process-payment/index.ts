// supabase/functions/process-payment/index.ts
// Wrapper sur RPC complete_order_with_payment.
// Capture les exceptions Postgres et les remappe en réponses HTTP propres.
// Logs Sentry server-side optionnel.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

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
  });

  if (error) {
    console.error('complete_order_with_payment error', error);
    // Map Postgres error codes
    if (error.code === 'P0001') return jsonResponse({ error: 'no_open_session', message: error.message }, 409);
    if (error.code === 'P0002') return jsonResponse({ error: 'insufficient_stock', message: error.message }, 409);
    if (error.code === 'P0003') return jsonResponse({ error: 'permission_denied', message: error.message }, 403);
    return jsonResponse({ error: 'internal', message: error.message }, 500);
  }

  return jsonResponse(data);
});
