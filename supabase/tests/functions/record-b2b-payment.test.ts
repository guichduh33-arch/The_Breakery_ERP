// supabase/tests/functions/record-b2b-payment.test.ts
// Session 24 / Phase 1.A.4 — Vitest live RPC tests for B2B Foundation.
//
// Couvre les RPCs S24 :
//   - record_b2b_payment_v1 (happy path, idempotency, overpayment)
//   - create_b2b_order_v1   (happy path + then payment chain)
//   - adjust_b2b_balance_v1 (±delta chain)
//
// 5 scénarios :
//   S1 : create B2B customer + B2B order + record full payment → balance=0
//   S2 : idempotency replay (call 2x avec même UUID) → 2e call retourne 1er row
//   S3 : create+pay, then 2nd payment partial → balance reflect
//   S4 : overpayment rejected (P0011)
//   S5 : adjust_b2b_balance ±delta chain
//
// Bootstrap : service-role pour seed customer + product, MANAGER token pour
// appeler les RPCs (toutes gated par customers.update / pos.sale.create).
// Cleanup : afterAll best-effort sur b2b_payments / orders / customers.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const PIN_FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

async function loginAs(employeeCode: string, pin: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE);
  await admin.from('user_profiles')
    .update({ failed_login_attempts: 0, locked_until: null })
    .eq('employee_code', employeeCode);
  const { data: profile } = await admin.from('user_profiles')
    .select('id').eq('employee_code', employeeCode).single();
  if (!profile) throw new Error(`No profile for ${employeeCode}`);

  const res = await fetch(PIN_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: profile.id, pin, device_type: 'pos' }),
  });
  const body = await res.json();
  if (!body.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.auth.access_token as string;
}

function jwtClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Type-erased rpc helper (generated types may lag behind staging migrations).
function rpc(sb: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string; code?: string } | null }>;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('B2B Foundation — record_b2b_payment_v1 + create_b2b_order_v1 + adjust', () => {
  let managerToken: string;
  let customerId: string;
  let productId: string;
  const createdPaymentIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Stable test B2B customer
    const { data: existing } = await admin.from('customers')
      .select('id').eq('name', 'B2B_LIVE_TEST').maybeSingle();
    if (existing) {
      customerId = existing.id;
      await admin.from('customers')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({
          customer_type: 'b2b',
          b2b_company_name: 'PT B2B Live Test',
          b2b_credit_limit: 10000000,
          b2b_current_balance: 0,
        } as any)
        .eq('id', customerId);
    } else {
      const { data: c, error } = await admin.from('customers')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({
          name: 'B2B_LIVE_TEST',
          customer_type: 'b2b',
          b2b_company_name: 'PT B2B Live Test',
          b2b_credit_limit: 10000000,
          b2b_current_balance: 0,
        } as any)
        .select('id').single();
      if (error) throw error;
      customerId = c!.id;
    }

    // Reuse stable test product (provisioned by inventory live tests)
    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').maybeSingle();
    if (!p) {
      // Fallback : use any product with stock
      const { data: any_p } = await admin.from('products')
        .select('id').gte('current_stock', 10).limit(1).single();
      if (!any_p) throw new Error('No product with stock available for B2B live test');
      productId = any_p.id;
    } else {
      productId = p.id;
    }
    // Bump stock to ensure we don't run out
    await admin.from('products')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ current_stock: 1000 } as any)
      .eq('id', productId);
  });

  afterAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    // Best-effort cleanup. RLS revokes UPDATE/DELETE on b2b_payments for
    // authenticated, but service-role bypasses RLS.
    for (const id of createdPaymentIds) {
      try { await admin.from('b2b_payments').delete().eq('id', id); } catch (_) { /* ignore */ }
    }
    for (const id of createdOrderIds) {
      try { await admin.from('order_items').delete().eq('order_id', id); } catch (_) { /* ignore */ }
      try { await admin.from('stock_movements').delete().eq('reference_id', id); } catch (_) { /* ignore */ }
      try { await admin.from('orders').delete().eq('id', id); } catch (_) { /* ignore */ }
    }
    // Reset balance for stable customer
    try {
      await admin.from('customers')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ b2b_current_balance: 0 } as any)
        .eq('id', customerId);
    } catch (_) { /* ignore */ }
  });

  it('S1: create_b2b_order + record_b2b_payment full → balance back to 0', async () => {
    const sb = jwtClient(managerToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Reset balance via service-role (bypass REVOKE)
    await admin.from('customers')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ b2b_current_balance: 0 } as any)
      .eq('id', customerId);

    const { data: orderResult, error: orderErr } = await rpc(sb)('create_b2b_order_v1', {
      p_customer_id: customerId,
      p_items: [{ product_id: productId, quantity: 2, unit_price: 25000 }],
    });
    expect(orderErr).toBeNull();
    expect(orderResult).not.toBeNull();
    const orderId = orderResult.order_id as string;
    createdOrderIds.push(orderId);
    expect(Number(orderResult.total)).toBe(50000);
    expect(Number(orderResult.credit_after)).toBe(50000);

    const { data: payResult, error: payErr } = await rpc(sb)('record_b2b_payment_v1', {
      p_customer_id: customerId,
      p_amount: 50000,
      p_method: 'cash',
    });
    expect(payErr).toBeNull();
    expect(payResult).not.toBeNull();
    createdPaymentIds.push(payResult.payment_id as string);
    expect(Number(payResult.customer_balance_after)).toBe(0);
    expect(typeof payResult.payment_number).toBe('string');
    expect((payResult.payment_number as string).startsWith('BP-')).toBe(true);

    // Verify balance via SELECT
    const { data: cust } = await admin.from('customers')
      .select('b2b_current_balance').eq('id', customerId).single();
    expect(Number(cust!.b2b_current_balance)).toBe(0);
  });

  it('S2: record_b2b_payment idempotency — same key returns same row', async () => {
    const sb = jwtClient(managerToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Bring balance to 30000 via adjust_b2b_balance (we have permission)
    await admin.from('customers')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ b2b_current_balance: 30000 } as any)
      .eq('id', customerId);

    const idempotencyKey = crypto.randomUUID();
    const args = {
      p_customer_id: customerId,
      p_amount: 10000,
      p_method: 'transfer',
      p_idempotency_key: idempotencyKey,
    };

    const first = await rpc(sb)('record_b2b_payment_v1', args);
    expect(first.error).toBeNull();
    createdPaymentIds.push(first.data.payment_id as string);
    expect(first.data.idempotent_replay).toBe(false);

    const second = await rpc(sb)('record_b2b_payment_v1', args);
    expect(second.error).toBeNull();
    expect(second.data.payment_id).toBe(first.data.payment_id);
    expect(second.data.idempotent_replay).toBe(true);

    // Verify exactly 1 row inserted with this key
    const { data: rows } = await admin.from('b2b_payments')
      .select('id').eq('idempotency_key', idempotencyKey);
    expect((rows ?? []).length).toBe(1);
  });

  it('S3: 2nd partial payment after order — balance reflects', async () => {
    const sb = jwtClient(managerToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    await admin.from('customers')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ b2b_current_balance: 0 } as any)
      .eq('id', customerId);

    // 1) Create order 100K
    const { data: orderRes, error: orderErr } = await rpc(sb)('create_b2b_order_v1', {
      p_customer_id: customerId,
      p_items: [{ product_id: productId, quantity: 4, unit_price: 25000 }],
    });
    expect(orderErr).toBeNull();
    createdOrderIds.push(orderRes.order_id as string);
    expect(Number(orderRes.credit_after)).toBe(100000);

    // 2) Partial payment 40K
    const { data: pay1, error: pay1Err } = await rpc(sb)('record_b2b_payment_v1', {
      p_customer_id: customerId,
      p_amount: 40000,
      p_method: 'cash',
    });
    expect(pay1Err).toBeNull();
    createdPaymentIds.push(pay1.payment_id as string);
    expect(Number(pay1.customer_balance_after)).toBe(60000);

    // 3) Partial payment 35K
    const { data: pay2, error: pay2Err } = await rpc(sb)('record_b2b_payment_v1', {
      p_customer_id: customerId,
      p_amount: 35000,
      p_method: 'transfer',
    });
    expect(pay2Err).toBeNull();
    createdPaymentIds.push(pay2.payment_id as string);
    expect(Number(pay2.customer_balance_after)).toBe(25000);
  });

  it('S4: overpayment rejected with P0011', async () => {
    const sb = jwtClient(managerToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    await admin.from('customers')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ b2b_current_balance: 10000 } as any)
      .eq('id', customerId);

    const { data, error } = await rpc(sb)('record_b2b_payment_v1', {
      p_customer_id: customerId,
      p_amount: 20000,
      p_method: 'cash',
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('overpayment');
  });

  it('S5: adjust_b2b_balance positive then negative chain', async () => {
    const sb = jwtClient(managerToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    await admin.from('customers')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ b2b_current_balance: 50000 } as any)
      .eq('id', customerId);

    // +30K
    const { data: r1, error: e1 } = await rpc(sb)('adjust_b2b_balance_v1', {
      p_customer_id: customerId,
      p_delta: 30000,
      p_reason: 'S5 positive adjustment test',
    });
    expect(e1).toBeNull();
    expect(Number(r1.balance_after)).toBe(80000);

    // -20K
    const { data: r2, error: e2 } = await rpc(sb)('adjust_b2b_balance_v1', {
      p_customer_id: customerId,
      p_delta: -20000,
      p_reason: 'S5 negative adjustment test',
    });
    expect(e2).toBeNull();
    expect(Number(r2.balance_after)).toBe(60000);

    // Underflow attempt → expect error
    const { data: r3, error: e3 } = await rpc(sb)('adjust_b2b_balance_v1', {
      p_customer_id: customerId,
      p_delta: -100000,
      p_reason: 'S5 underflow attempt',
    });
    expect(r3).toBeNull();
    expect(e3).not.toBeNull();
    expect(e3!.message.toLowerCase()).toContain('underflow');
  });
});
