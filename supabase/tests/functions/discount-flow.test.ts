import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PIN_FN_URL   = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

describe('session 6 — discount flow + loyalty multiplier', () => {
  let admin: ReturnType<typeof createClient>;
  let cashierClient: ReturnType<typeof createClient>;
  let cashierId:    string;
  let managerId:    string;
  let sessionId:    string;
  let productId:    string;
  let productPrice: number;
  let walkinId:     string;
  let goldId:       string;

  const login = async (employeeCode: string, pin: string) => {
    await admin.from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('employee_code', employeeCode);

    const { data: profile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', employeeCode).single();
    if (!profile) throw new Error(`Profile not found: ${employeeCode}`);

    const res = await fetch(PIN_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: profile.id, pin, device_type: 'pos' }),
    });
    const body = await res.json();
    if (!body.auth?.access_token) throw new Error(`Login failed for ${employeeCode}: ${JSON.stringify(body)}`);
    return { profileId: profile.id, accessToken: body.auth.access_token };
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE);

    const cashier = await login('EMP000', '123456');
    cashierId = cashier.profileId;

    cashierClient = createClient(SUPABASE_URL, SERVICE, {
      global: { headers: { Authorization: `Bearer ${cashier.accessToken}` } },
    });

    await admin.from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: cashierId })
      .eq('opened_by', cashierId).eq('status', 'open');

    const { data: session, error: sessionErr } = await admin.from('pos_sessions')
      .insert({ opened_by: cashierId, opening_cash: 100000 }).select('id').single();
    if (sessionErr || !session) throw new Error(`POS session failed: ${JSON.stringify(sessionErr)}`);
    sessionId = session.id;

    const { data: products } = await admin.from('products')
      .select('id, retail_price').limit(1);
    if (!products?.length) throw new Error('Need at least 1 product');
    productId    = products[0].id;
    productPrice = products[0].retail_price;
    await admin.from('products').update({ current_stock: 200 }).eq('id', productId);

    const { data: customers } = await admin.from('customers')
      .select('id, phone').in('phone', ['+62811111111', '+62833333333']);
    if (!customers?.length) throw new Error('Demo customers not seeded — run supabase db reset');
    walkinId = customers.find(c => c.phone === '+62811111111')!.id;
    goldId   = customers.find(c => c.phone === '+62833333333')!.id;

    await admin.from('customers')
      .update({ loyalty_points: 2500, lifetime_points: 2500 })
      .eq('id', goldId);

    const { data: mgr } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP003').single();
    if (mgr) managerId = mgr.id;
  });

  describe('complete_order_with_payment v5 — cart-level discount', () => {
    it('applies cart-level discount: total = items_total - discount_amount', async () => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', productId);

      const discountAmt = 3500;
      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id:      sessionId,
        p_order_type:      'take_out',
        p_items:           [{ product_id: productId, quantity: 1, unit_price: productPrice }],
        p_payment:         { method: 'cash', amount: productPrice - discountAmt, cash_received: productPrice - discountAmt },
        p_discount_amount: discountAmt,
        p_discount_type:   'fixed_amount',
        p_discount_value:  discountAmt,
        p_discount_reason: 'Staff promo',
      });

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(Number(data.total)).toBe(productPrice - discountAmt);
      expect(Number(data.discount_amount)).toBe(discountAmt);

      const { data: order } = await admin.from('orders')
        .select('total, discount_amount, discount_type, discount_value, discount_reason')
        .eq('id', data.order_id).single();
      expect(Number(order!.total)).toBe(productPrice - discountAmt);
      expect(Number(order!.discount_amount)).toBe(discountAmt);
      expect(order!.discount_type).toBe('fixed_amount');
      expect(order!.discount_reason).toBe('Staff promo');
    });

    it('JE is balanced after cart-level discount', async () => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', productId);

      const discountAmt = 3500;
      const { data } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id:      sessionId,
        p_order_type:      'take_out',
        p_items:           [{ product_id: productId, quantity: 1, unit_price: productPrice }],
        p_payment:         { method: 'cash', amount: productPrice - discountAmt, cash_received: productPrice - discountAmt },
        p_discount_amount: discountAmt,
        p_discount_reason: 'Test discount JE',
      });

      const { data: je } = await admin.from('journal_entries')
        .select('total_debit, total_credit')
        .eq('reference_type', 'sale')
        .eq('reference_id', data.order_id)
        .single();
      expect(je).not.toBeNull();
      expect(Number(je!.total_debit)).toBe(Number(je!.total_credit));
    });

    it('raises check_violation when discount exceeds items total', async () => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', productId);

      const { error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id:      sessionId,
        p_order_type:      'take_out',
        p_items:           [{ product_id: productId, quantity: 1, unit_price: productPrice }],
        p_payment:         { method: 'cash', amount: 0, cash_received: 0 },
        p_discount_amount: productPrice + 99999,
        p_discount_reason: 'This should fail',
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('check_violation');
    });

    it('idempotency key replay returns same order_id', async () => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', productId);

      const key = crypto.randomUUID();
      const payload = {
        p_session_id:      sessionId,
        p_order_type:      'take_out' as const,
        p_items:           [{ product_id: productId, quantity: 1, unit_price: productPrice }],
        p_payment:         { method: 'cash' as const, amount: productPrice, cash_received: productPrice },
        p_idempotency_key: key,
        p_discount_amount: 0,
      };

      const { data: d1 } = await cashierClient.rpc('complete_order_with_payment', payload);
      const { data: d2 } = await cashierClient.rpc('complete_order_with_payment', payload);
      expect(d1.order_id).toBe(d2.order_id);
      expect(d2.idempotent_replay).toBe(true);
    });
  });

  describe('complete_order_with_payment v5 — loyalty multiplier', () => {
    it('earn uses multiplier: FLOOR(total * multiplier / 1000)', async () => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', productId);

      const multiplier = 1.1;
      const amount = 35000;
      const expectedEarn = Math.floor(amount * multiplier / 1000);

      await admin.from('customers')
        .update({ loyalty_points: 2500, lifetime_points: 2500 })
        .eq('id', goldId);
      const { data: before } = await admin.from('customers')
        .select('loyalty_points').eq('id', goldId).single();

      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id:         sessionId,
        p_order_type:         'dine_in',
        p_items:              [{ product_id: productId, quantity: 1, unit_price: amount }],
        p_payment:            { method: 'cash', amount, cash_received: amount },
        p_customer_id:        goldId,
        p_loyalty_multiplier: multiplier,
      });

      expect(error).toBeNull();
      expect(data.loyalty_points_earned).toBe(expectedEarn);

      const { data: after } = await admin.from('customers')
        .select('loyalty_points').eq('id', goldId).single();
      expect(after!.loyalty_points).toBe(before!.loyalty_points + expectedEarn);
    });

    it('multiplier 1.0 earns FLOOR(total / 1000) — backward-compat', async () => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', productId);

      const amount = 35000;
      const expectedEarn = Math.floor(amount / 1000);

      await admin.from('customers')
        .update({ loyalty_points: 0, lifetime_points: 100 })
        .eq('id', walkinId);

      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id:         sessionId,
        p_order_type:         'take_out',
        p_items:              [{ product_id: productId, quantity: 1, unit_price: amount }],
        p_payment:            { method: 'cash', amount, cash_received: amount },
        p_customer_id:        walkinId,
        p_loyalty_multiplier: 1.0,
      });

      expect(error).toBeNull();
      expect(data.loyalty_points_earned).toBe(expectedEarn);
    });
  });

  describe('pay_existing_order v2 — cart discount at pickup', () => {
    let waiterClient: ReturnType<typeof createClient>;
    let waiterId: string;

    beforeAll(async () => {
      const waiter = await login('EMP002', '567800');
      waiterId = waiter.profileId;
      waiterClient = createClient(SUPABASE_URL, SERVICE, {
        global: { headers: { Authorization: `Bearer ${waiter.accessToken}` } },
      });
    });

    const item = () => [{ product_id: productId, quantity: 1, unit_price: productPrice, modifiers: [] }];

    it('applies cart-level discount at pickup: total = items_total - discount, JE balanced', async () => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', productId);

      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id:    waiterId,
        p_table_number: 'T-01',
        p_order_type:   'dine_in',
        p_items:        item(),
      });
      await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });

      const discountAmt = 5000;
      const expectedTotal = productPrice - discountAmt;

      const { data: paidId, error } = await cashierClient.rpc('pay_existing_order', {
        p_order_id:        orderId,
        p_payment:         { method: 'cash', amount: expectedTotal, cash_received: expectedTotal },
        p_discount_amount: discountAmt,
        p_discount_type:   'fixed_amount',
        p_discount_value:  discountAmt,
        p_discount_reason: 'Pickup discount',
      });

      expect(error).toBeNull();
      expect(paidId).toBe(orderId);

      const { data: order } = await admin.from('orders')
        .select('total, discount_amount, discount_type, discount_reason')
        .eq('id', orderId).single();
      expect(Number(order!.total)).toBe(expectedTotal);
      expect(Number(order!.discount_amount)).toBe(discountAmt);
      expect(order!.discount_type).toBe('fixed_amount');
      expect(order!.discount_reason).toBe('Pickup discount');

      const { data: je } = await admin.from('journal_entries')
        .select('total_debit, total_credit')
        .eq('reference_id', orderId).single();
      expect(Number(je!.total_debit)).toBe(Number(je!.total_credit));
    });

    it('applies loyalty multiplier earn at pickup', async () => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', productId);
      await admin.from('customers')
        .update({ loyalty_points: 2500, lifetime_points: 2500 }).eq('id', goldId);

      const { data: before } = await admin.from('customers')
        .select('loyalty_points').eq('id', goldId).single();

      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id:    waiterId,
        p_table_number: 'T-02',
        p_order_type:   'dine_in',
        p_items:        item(),
      });
      await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });

      const multiplier = 1.1;
      const expectedEarn = Math.floor(productPrice * multiplier / 1000);

      const { error } = await cashierClient.rpc('pay_existing_order', {
        p_order_id:           orderId,
        p_payment:            { method: 'cash', amount: productPrice, cash_received: productPrice },
        p_customer_id:        goldId,
        p_loyalty_multiplier: multiplier,
      });
      expect(error).toBeNull();

      const { data: after } = await admin.from('customers')
        .select('loyalty_points').eq('id', goldId).single();
      expect(after!.loyalty_points).toBe(before!.loyalty_points + expectedEarn);
    });
  });

  describe('auth-verify-pin — required_permission extension', () => {
    it('returns 200 + verified_user_id when manager PIN has sales.discount', async () => {
      if (!managerId) {
        console.warn('Manager Demo (EMP003) not seeded — skipping');
        return;
      }

      await admin.from('user_profiles')
        .update({ failed_login_attempts: 0, locked_until: null })
        .eq('employee_code', 'EMP003');

      const res = await fetch(PIN_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:             managerId,
          pin:                 '111111',
          device_type:         'pos',
          required_permission: 'sales.discount',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.verified_user_id).toBe(managerId);
      expect(body.user.role_code).toBe('MANAGER');
    });

    it('returns 403 PERMISSION_MISSING when cashier PIN lacks sales.discount', async () => {
      const { data: cashierProfile } = await admin.from('user_profiles')
        .select('id').eq('employee_code', 'EMP001').single();
      if (!cashierProfile) {
        console.warn('Test Cashier (EMP001) not seeded — skipping');
        return;
      }

      await admin.from('user_profiles')
        .update({ failed_login_attempts: 0, locked_until: null })
        .eq('employee_code', 'EMP001');

      const res = await fetch(PIN_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:             cashierProfile.id,
          pin:                 '567890',
          device_type:         'pos',
          required_permission: 'sales.discount',
        }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('permission_denied');
      expect(body.code).toBe('PERMISSION_MISSING');
    });

    it('returns 200 without required_permission — back-compat unchanged', async () => {
      const { data: profile } = await admin.from('user_profiles')
        .select('id').eq('employee_code', 'EMP000').single();

      await admin.from('user_profiles')
        .update({ failed_login_attempts: 0, locked_until: null })
        .eq('employee_code', 'EMP000');

      const res = await fetch(PIN_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: profile!.id, pin: '123456', device_type: 'pos' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.id).toBe(profile!.id);
      expect(body.auth.access_token).toBeTruthy();
    });
  });
});
