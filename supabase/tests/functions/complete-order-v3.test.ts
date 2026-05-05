import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const FN_URL       = `${SUPABASE_URL}/functions/v1/process-payment`;

describe('complete_order_with_payment v3 — loyalty', () => {
  let accessToken: string;
  let sessionId:   string;
  let productId:   string;
  let walkinId:    string;
  let bronzeId:    string;
  let goldId:      string;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);

    await admin.from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('employee_code', 'EMP000');

    const { data: profile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP000').single();
    if (!profile) throw new Error('Seed not loaded');

    const loginRes = await fetch(`${SUPABASE_URL}/functions/v1/auth-verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: profile.id, pin: '1234', device_type: 'pos' }),
    });
    const loginBody = await loginRes.json();
    if (!loginBody.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(loginBody)}`);
    accessToken = loginBody.auth.access_token;

    await admin.from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: profile.id })
      .eq('opened_by', profile.id).eq('status', 'open');

    const { data: session, error: sessionErr } = await admin.from('pos_sessions')
      .insert({ opened_by: profile.id, opening_cash: 100000 }).select('id').single();
    if (sessionErr || !session) throw new Error(`POS session failed: ${JSON.stringify(sessionErr)}`);
    sessionId = session.id;

    const { data: products } = await admin.from('products').select('id').limit(1);
    if (!products?.length) throw new Error('Need at least 1 product in seed');
    productId = products[0].id;
    await admin.from('products').update({ current_stock: 100 }).eq('id', productId);

    const { data: customers } = await admin.from('customers')
      .select('id, phone').in('phone', ['+62811111111', '+62822222222', '+62833333333']);
    if (!customers?.length) throw new Error('Demo customers not seeded — run supabase db reset');

    walkinId = customers.find(c => c.phone === '+62811111111')!.id;
    bronzeId = customers.find(c => c.phone === '+62822222222')!.id;
    goldId   = customers.find(c => c.phone === '+62833333333')!.id;

    await admin.from('customers').update({ loyalty_points: 120, lifetime_points: 120 }).eq('id', bronzeId);
    await admin.from('customers').update({ loyalty_points: 2500, lifetime_points: 2500 }).eq('id', goldId);
  });

  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  });

  it('earns FLOOR(total/1000) points when customer attached', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const beforeCustomer = await admin.from('customers').select('loyalty_points').eq('id', walkinId).single();
    const ptsBefore = beforeCustomer.data!.loyalty_points;

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        session_id:  sessionId,
        order_type:  'dine_in',
        items:       [{ product_id: productId, quantity: 1, unit_price: 35000 }],
        payment:     { method: 'cash', amount: 35000, cash_received: 35000 },
        customer_id: walkinId,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loyalty_points_earned).toBe(35);

    const afterCustomer = await admin.from('customers').select('loyalty_points').eq('id', walkinId).single();
    expect(afterCustomer.data!.loyalty_points).toBe(ptsBefore + 35);
  });

  it('earns 0 and creates no loyalty_transactions when no customer attached', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const countBefore = (await admin.from('loyalty_transactions').select('id', { count: 'exact', head: true })).count ?? 0;

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        session_id: sessionId,
        order_type: 'take_out',
        items:      [{ product_id: productId, quantity: 1, unit_price: 35000 }],
        payment:    { method: 'cash', amount: 35000, cash_received: 35000 },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loyalty_points_earned).toBe(0);
    expect(body.customer_id).toBeNull();

    const countAfter = (await admin.from('loyalty_transactions').select('id', { count: 'exact', head: true })).count ?? 0;
    expect(countAfter).toBe(countBefore);
  });

  it('redeem reduces total and creates JE lines for LOYALTY_LIABILITY and SALE_DISCOUNT', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        session_id:                sessionId,
        order_type:                'dine_in',
        items:                     [{ product_id: productId, quantity: 1, unit_price: 35000 }],
        payment:                   { method: 'cash', amount: 30000, cash_received: 30000 },
        customer_id:               goldId,
        loyalty_points_redeemed:   500,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(30000);
    expect(body.loyalty_redemption_amount).toBe(5000);
    expect(body.loyalty_points_redeemed).toBe(500);

    const { data: je } = await admin.from('journal_entries')
      .select('id, total_debit, total_credit')
      .eq('reference_type', 'sale')
      .eq('reference_id', body.order_id)
      .single();
    expect(je).not.toBeNull();
    expect(je!.total_debit).toBe(je!.total_credit);

    const { data: lines } = await admin.from('journal_entry_lines')
      .select('account_id, debit, credit')
      .eq('journal_entry_id', je!.id);
    const { data: loyaltyAcct } = await admin.from('accounts').select('id').eq('code', '2210').single();
    const { data: discountAcct } = await admin.from('accounts').select('id').eq('code', '4900').single();

    const liabilityLine = lines?.find(l => l.account_id === loyaltyAcct!.id);
    const discountLine  = lines?.find(l => l.account_id === discountAcct!.id);
    expect(liabilityLine?.debit).toBe(5000);
    expect(discountLine?.credit).toBe(5000);
  });

  it('raises P0010 on insufficient loyalty points', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        session_id:              sessionId,
        order_type:              'dine_in',
        items:                   [{ product_id: productId, quantity: 1, unit_price: 35000 }],
        payment:                 { method: 'cash', amount: 35000, cash_received: 35000 },
        customer_id:             bronzeId,
        loyalty_points_redeemed: 9999900,
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/insufficient/i);
  });

  it('raises check_violation when points not multiple of 100', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        session_id:              sessionId,
        order_type:              'dine_in',
        items:                   [{ product_id: productId, quantity: 1, unit_price: 35000 }],
        payment:                 { method: 'cash', amount: 35000, cash_received: 35000 },
        customer_id:             bronzeId,
        loyalty_points_redeemed: 99,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('raises check_violation when redeeming without a customer', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        session_id:              sessionId,
        order_type:              'dine_in',
        items:                   [{ product_id: productId, quantity: 1, unit_price: 35000 }],
        payment:                 { method: 'cash', amount: 35000, cash_received: 35000 },
        loyalty_points_redeemed: 100,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('idempotency key replay returns same order_id', async () => {
    const key = crypto.randomUUID();
    const payload = {
      session_id:  sessionId,
      order_type:  'take_out' as const,
      items:       [{ product_id: productId, quantity: 1, unit_price: 35000 }],
      payment:     { method: 'cash' as const, amount: 35000, cash_received: 35000 },
      customer_id: walkinId,
      idempotency_key: key,
    };

    const first  = await fetch(FN_URL, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
    const second = await fetch(FN_URL, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const [b1, b2] = await Promise.all([first.json(), second.json()]);
    expect(b2.order_id).toBe(b1.order_id);
    expect(b2.idempotent_replay).toBe(true);
  });

  it('DB: orders + customers + loyalty_transactions reflect redeem correctly', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('customers').update({ loyalty_points: 2500, lifetime_points: 2500 }).eq('id', goldId);

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        session_id:              sessionId,
        order_type:              'dine_in',
        items:                   [{ product_id: productId, quantity: 1, unit_price: 35000 }],
        payment:                 { method: 'cash', amount: 30000, cash_received: 30000 },
        customer_id:             goldId,
        loyalty_points_redeemed: 500,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const { data: order } = await admin.from('orders').select('*').eq('id', body.order_id).single();
    expect(order!.customer_id).toBe(goldId);
    expect(order!.loyalty_points_redeemed).toBe(500);
    expect(order!.loyalty_redemption_amount).toBe(5000);
    expect(Number(order!.loyalty_points_earned)).toBe(30);

    const { data: customer } = await admin.from('customers').select('*').eq('id', goldId).single();
    expect(customer!.loyalty_points).toBe(2030);
    expect(customer!.lifetime_points).toBe(2530);

    const { data: txns } = await admin.from('loyalty_transactions')
      .select('*').eq('order_id', body.order_id).order('created_at');
    expect(txns).toHaveLength(2);
    expect(txns![0].transaction_type).toBe('redeem');
    expect(txns![0].points).toBe(-500);
    expect(txns![1].transaction_type).toBe('earn');
    expect(txns![1].points).toBe(30);
  });
});
