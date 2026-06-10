import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const FN_URL = `${SUPABASE_URL}/functions/v1/process-payment`;

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('process-payment', () => {
  let accessToken: string;
  let sessionId: string;
  let productIds: string[] = [];

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Reset any lockout and get admin profile
    await admin
      .from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('employee_code', 'EMP000');
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id')
      .eq('employee_code', 'EMP000')
      .single();
    if (!profile) throw new Error('Seed not loaded — run supabase db reset');

    // Login admin via auth-verify-pin
    const loginRes = await fetch(`${SUPABASE_URL}/functions/v1/auth-verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: profile.id, pin: '1234', device_type: 'pos' }),
    });
    const loginBody = await loginRes.json();
    if (!loginBody.auth?.access_token) {
      throw new Error(`Login failed: ${JSON.stringify(loginBody)}`);
    }
    accessToken = loginBody.auth.access_token;

    // Close any existing open session for admin
    await admin
      .from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: profile.id })
      .eq('opened_by', profile.id)
      .eq('status', 'open');

    // Create a new open POS session via direct insert
    const { data: session, error: sessionErr } = await admin
      .from('pos_sessions')
      .insert({ opened_by: profile.id, opening_cash: 100000 })
      .select('id')
      .single();
    if (sessionErr || !session) {
      throw new Error(`POS session creation failed: ${JSON.stringify(sessionErr)}`);
    }
    sessionId = session.id;

    // Get two products for testing
    const { data: products } = await admin.from('products').select('id').limit(2);
    productIds = (products ?? []).map((p: { id: string }) => p.id);
    if (productIds.length < 2) throw new Error('Need at least 2 products in seed');

    // Reset stock to ensure tests pass
    await admin
      .from('products')
      .update({ current_stock: 50 })
      .in('id', productIds);
  });

  it('creates an order on valid payload', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [
          { product_id: productIds[0], quantity: 1, unit_price: 35000 },
          { product_id: productIds[1], quantity: 1, unit_price: 45000 },
        ],
        payment: { method: 'cash', amount: 80000, cash_received: 100000, change_given: 20000 },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order_number).toMatch(/^#\d{4}$/);
    expect(body.subtotal).toBe(80000);
    expect(body.change_given).toBe(20000);
  });

  it('rejects on insufficient stock', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [{ product_id: productIds[0], quantity: 99999, unit_price: 35000 }],
        payment: { method: 'cash', amount: 35000 * 99999, cash_received: 35000 * 99999 },
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('insufficient_stock');
  });

  it('returns existing order on duplicate idempotency_key (D8)', async () => {
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      session_id: sessionId,
      order_type: 'dine_in' as const,
      items: [
        { product_id: productIds[0], quantity: 1, unit_price: 35000 },
        { product_id: productIds[1], quantity: 1, unit_price: 45000 },
      ],
      payment: { method: 'cash' as const, amount: 80000, cash_received: 100000, change_given: 20000 },
      idempotency_key: idempotencyKey,
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };

    // 1st POST — should create the order
    const first = await fetch(FN_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.order_id).toBeTruthy();

    // 2nd POST — same key, same payload → must return the same order_id (replay)
    const second = await fetch(FN_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.order_id).toBe(firstBody.order_id);
    // RPC should flag the replay so the client can act on it
    expect(secondBody.idempotent_replay).toBe(true);
  });

  it('rejects when idempotency_key is not a UUID', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [{ product_id: productIds[0], quantity: 1, unit_price: 35000 }],
        payment: { method: 'cash', amount: 35000, cash_received: 35000 },
        idempotency_key: 'not-a-uuid',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_idempotency_key');
  });

  it('accepts customer_id and loyalty_points_redeemed in payload and forwards to RPC', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: customer } = await admin
      .from('customers')
      .select('id, loyalty_points')
      .eq('name', 'Loyal Gold Customer')
      .single();
    if (!customer) return;

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'dine_in',
        items: [{ product_id: productIds[0], quantity: 1, unit_price: 35000 }],
        payment: { method: 'cash', amount: 30000, cash_received: 30000 },
        customer_id: customer.id,
        loyalty_points_redeemed: 500,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order_id).toBeTruthy();
  });
});
