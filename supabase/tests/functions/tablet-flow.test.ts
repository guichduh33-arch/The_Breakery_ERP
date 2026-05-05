import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe('tablet flow — create / pickup / pay / cancel', () => {
  let admin: ReturnType<typeof createClient>;
  let waiterClient: ReturnType<typeof createClient>;
  let cashierClient: ReturnType<typeof createClient>;
  let waiterId:   string;
  let cashierId:  string;
  let sessionId:  string;
  let productId:  string;
  let productPrice: number;
  let goldCustomerId: string;

  const login = async (employeeCode: string, pin: string) => {
    const { data: profile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', employeeCode).single();
    if (!profile) throw new Error(`Profile not found: ${employeeCode}`);

    await admin.from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('employee_code', employeeCode);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-verify-pin`, {
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

    const waiter  = await login('EMP002', '5678');
    const cashier = await login('EMP000', '1234');

    waiterId  = waiter.profileId;
    cashierId = cashier.profileId;

    waiterClient  = createClient(SUPABASE_URL, SERVICE, {
      global: { headers: { Authorization: `Bearer ${waiter.accessToken}` } },
    });
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
    await admin.from('products').update({ current_stock: 100 }).eq('id', productId);

    const { data: customers } = await admin.from('customers')
      .select('id').eq('phone', '+62833333333').single();
    if (customers) goldCustomerId = customers.id;
    await admin.from('customers')
      .update({ loyalty_points: 2500, lifetime_points: 2500 })
      .eq('id', goldCustomerId);
  });

  const item = () => [{ product_id: productId, quantity: 1, unit_price: productPrice, modifiers: [] }];

  describe('create_tablet_order', () => {
    it('creates order with status pending_payment and locked items', async () => {
      const { data: orderId, error } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id:    waiterId,
        p_table_number: 'T-01',
        p_order_type:   'dine_in',
        p_items:        item(),
      });

      expect(error).toBeNull();
      expect(orderId).toBeTruthy();

      const { data: order } = await admin.from('orders').select('*').eq('id', orderId).single();
      expect(order!.status).toBe('pending_payment');
      expect(order!.created_via).toBe('tablet');
      expect(order!.waiter_id).toBe(waiterId);
      expect(order!.table_number).toBe('T-01');

      const { data: items } = await admin.from('order_items').select('*').eq('order_id', orderId);
      expect(items).toHaveLength(1);
      expect(items![0].is_locked).toBe(true);
      expect(items![0].kitchen_status).toBe('pending');
      expect(items![0].sent_to_kitchen_at).not.toBeNull();

      const { data: je } = await admin.from('journal_entries')
        .select('id').eq('reference_id', orderId);
      expect(je).toHaveLength(0);

      const { data: sm } = await admin.from('stock_movements')
        .select('id').eq('reference_id', orderId);
      expect(sm).toHaveLength(0);
    });

    it('rejects empty items array', async () => {
      const { error } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id:    waiterId,
        p_table_number: 'T-02',
        p_order_type:   'take_out',
        p_items:        [],
      });
      expect(error).not.toBeNull();
    });
  });

  describe('cancel_tablet_order', () => {
    it('transitions pending_payment → voided', async () => {
      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-03',
        p_order_type: 'dine_in', p_items: item(),
      });

      const { data: row, error } = await waiterClient.rpc('cancel_tablet_order', {
        p_order_id: orderId,
      });
      expect(error).toBeNull();
      expect(row.status).toBe('voided');

      const { data: order } = await admin.from('orders').select('status').eq('id', orderId).single();
      expect(order!.status).toBe('voided');
    });

    it('raises P0013 when order is not pending_payment', async () => {
      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-03',
        p_order_type: 'dine_in', p_items: item(),
      });
      await waiterClient.rpc('cancel_tablet_order', { p_order_id: orderId });

      const { error } = await waiterClient.rpc('cancel_tablet_order', { p_order_id: orderId });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0013');
    });
  });

  describe('pickup_tablet_order', () => {
    it('transitions pending_payment → draft and binds session_id', async () => {
      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-04',
        p_order_type: 'dine_in', p_items: item(),
      });

      const { data: row, error } = await cashierClient.rpc('pickup_tablet_order', {
        p_order_id: orderId, p_session_id: sessionId,
      });
      expect(error).toBeNull();
      expect(row.status).toBe('draft');
      expect(row.session_id).toBe(sessionId);
    });

    it('raises P0012 on second pickup attempt (race condition)', async () => {
      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-05',
        p_order_type: 'dine_in', p_items: item(),
      });
      await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });

      const { error } = await cashierClient.rpc('pickup_tablet_order', {
        p_order_id: orderId, p_session_id: sessionId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0012');
    });

    it('raises P0012 when order is voided (cancelled before pickup)', async () => {
      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-01',
        p_order_type: 'take_out', p_items: item(),
      });
      await waiterClient.rpc('cancel_tablet_order', { p_order_id: orderId });

      const { error } = await cashierClient.rpc('pickup_tablet_order', {
        p_order_id: orderId, p_session_id: sessionId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0012');
    });
  });

  describe('pay_existing_order', () => {
    it('finalises draft order: status=paid, JE balanced, stock_movements created', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', productId);

      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-01',
        p_order_type: 'dine_in', p_items: item(),
      });
      await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });

      const { data: paidId, error } = await cashierClient.rpc('pay_existing_order', {
        p_order_id: orderId,
        p_payment:  { method: 'cash', amount: productPrice, cash_received: productPrice },
      });
      expect(error).toBeNull();
      expect(paidId).toBe(orderId);

      const { data: order } = await admin.from('orders').select('*').eq('id', orderId).single();
      expect(order!.status).toBe('paid');
      expect(order!.paid_at).not.toBeNull();
      expect(Number(order!.total)).toBe(productPrice);

      const { data: je } = await admin.from('journal_entries')
        .select('id, total_debit, total_credit').eq('reference_id', orderId).single();
      expect(je).not.toBeNull();
      expect(Number(je!.total_debit)).toBe(Number(je!.total_credit));

      const { data: sm } = await admin.from('stock_movements')
        .select('id').eq('reference_id', orderId);
      expect(sm!.length).toBeGreaterThan(0);
    });

    it('raises check_violation when order is not in draft status', async () => {
      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-01',
        p_order_type: 'dine_in', p_items: item(),
      });

      const { error } = await cashierClient.rpc('pay_existing_order', {
        p_order_id: orderId,
        p_payment:  { method: 'cash', amount: productPrice, cash_received: productPrice },
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('check_violation');
    });

    it('loyalty redeem reduces total, JE balanced with LOYALTY_LIABILITY + SALE_DISCOUNT lines', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', productId);
      await admin.from('customers')
        .update({ loyalty_points: 2500, lifetime_points: 2500 }).eq('id', goldCustomerId);

      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-02',
        p_order_type: 'dine_in', p_items: item(),
      });
      await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });

      const redeemPts   = 500;
      const redeemAmt   = redeemPts * 10;
      const expectedTotal = productPrice - redeemAmt;

      const { data: paidId, error } = await cashierClient.rpc('pay_existing_order', {
        p_order_id:               orderId,
        p_payment:                { method: 'cash', amount: expectedTotal, cash_received: expectedTotal },
        p_customer_id:            goldCustomerId,
        p_loyalty_points_redeemed: redeemPts,
      });
      expect(error).toBeNull();
      expect(paidId).toBe(orderId);

      const { data: order } = await admin.from('orders').select('total, loyalty_redemption_amount')
        .eq('id', orderId).single();
      expect(Number(order!.total)).toBe(expectedTotal);
      expect(Number(order!.loyalty_redemption_amount)).toBe(redeemAmt);

      const { data: je } = await admin.from('journal_entries')
        .select('id, total_debit, total_credit').eq('reference_id', orderId).single();
      expect(Number(je!.total_debit)).toBe(Number(je!.total_credit));

      const { data: lines } = await admin.from('journal_entry_lines')
        .select('account_id, debit, credit').eq('journal_entry_id', je!.id);
      const { data: loyaltyAcct }   = await admin.from('accounts').select('id').eq('code', '2210').single();
      const { data: discountAcct }  = await admin.from('accounts').select('id').eq('code', '4900').single();
      const liabilityLine = lines?.find(l => l.account_id === loyaltyAcct!.id);
      const discountLine  = lines?.find(l => l.account_id === discountAcct!.id);
      expect(Number(liabilityLine!.debit)).toBe(redeemAmt);
      expect(Number(discountLine!.credit)).toBe(redeemAmt);
    });

    it('idempotency key replay returns same order_id', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', productId);

      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-03',
        p_order_type: 'take_out', p_items: item(),
      });
      await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });

      const key = crypto.randomUUID();

      const { data: id1, error: e1 } = await cashierClient.rpc('pay_existing_order', {
        p_order_id:       orderId,
        p_payment:        { method: 'cash', amount: productPrice, cash_received: productPrice },
        p_idempotency_key: key,
      });
      expect(e1).toBeNull();

      const { data: id2, error: e2 } = await cashierClient.rpc('pay_existing_order', {
        p_order_id:       orderId,
        p_payment:        { method: 'cash', amount: productPrice, cash_received: productPrice },
        p_idempotency_key: key,
      });
      expect(e2).toBeNull();
      expect(id2).toBe(id1);
    });

    it('customer earns points on v_total after payment', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', productId);
      const { data: beforeCustomer } = await admin.from('customers')
        .select('loyalty_points').eq('id', goldCustomerId).single();
      const ptsBefore = beforeCustomer!.loyalty_points;

      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-04',
        p_order_type: 'dine_in', p_items: item(),
      });
      await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });

      await cashierClient.rpc('pay_existing_order', {
        p_order_id:    orderId,
        p_payment:     { method: 'cash', amount: productPrice, cash_received: productPrice },
        p_customer_id: goldCustomerId,
      });

      const expectedEarn = Math.floor(productPrice / 1000);
      const { data: afterCustomer } = await admin.from('customers')
        .select('loyalty_points').eq('id', goldCustomerId).single();
      expect(afterCustomer!.loyalty_points).toBe(ptsBefore + expectedEarn);
    });
  });

  describe('cancel_tablet_order after pickup raises P0013', () => {
    it('cannot cancel a picked-up (draft) order via cancel_tablet_order', async () => {
      const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
        p_waiter_id: waiterId, p_table_number: 'T-05',
        p_order_type: 'dine_in', p_items: item(),
      });
      await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });

      const { error } = await waiterClient.rpc('cancel_tablet_order', { p_order_id: orderId });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0013');
    });
  });
});
