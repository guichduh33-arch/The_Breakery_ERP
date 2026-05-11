import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Session 9 — `pay_existing_order` v4 integration tests.
// Spec §3.6, §5, §6 — same validation matrix as v7 but applied at pickup time.

const CHECK_VIOLATION = '23514';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PIN_FN_URL   = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

describe('pay_existing_order v4 — promotions at pickup', () => {
  let admin: ReturnType<typeof createClient>;
  let cashierClient: ReturnType<typeof createClient>;
  let waiterClient: ReturnType<typeof createClient>;
  let cashierId: string;
  let waiterId: string;
  let sessionId: string;
  let americanoId: string;
  let americanoPrice: number;
  let beverageCategoryId: string;
  let walkinCustomerId: string;
  let vipCategoryId: string;

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
    if (!body.auth?.access_token) {
      throw new Error(`Login failed for ${employeeCode}: ${JSON.stringify(body)}`);
    }
    return { profileId: profile.id, accessToken: body.auth.access_token };
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE);

    const cashier = await login('EMP000', '123456');
    cashierId = cashier.profileId;
    cashierClient = createClient(SUPABASE_URL, SERVICE, {
      global: { headers: { Authorization: `Bearer ${cashier.accessToken}` } },
    });

    const waiter = await login('EMP002', '567800');
    waiterId = waiter.profileId;
    waiterClient = createClient(SUPABASE_URL, SERVICE, {
      global: { headers: { Authorization: `Bearer ${waiter.accessToken}` } },
    });

    await admin.from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: cashierId })
      .eq('opened_by', cashierId).eq('status', 'open');

    const { data: session, error: sessionErr } = await admin.from('pos_sessions')
      .insert({ opened_by: cashierId, opening_cash: 100000 }).select('id').single();
    if (sessionErr || !session) throw new Error(`POS session failed: ${JSON.stringify(sessionErr)}`);
    sessionId = session.id;

    const { data: amer } = await admin.from('products')
      .select('id, retail_price').eq('sku', 'BEV-AMER').single();
    if (!amer) throw new Error('Seed missing BEV-AMER');
    americanoId = amer.id;
    americanoPrice = Number(amer.retail_price);
    await admin.from('products').update({ current_stock: 500 }).eq('id', americanoId);

    const { data: bevCat } = await admin.from('categories')
      .select('id').eq('slug', 'beverage').single();
    beverageCategoryId = bevCat!.id;

    const { data: vipCat } = await admin.from('customer_categories')
      .select('id').eq('slug', 'vip').single();
    vipCategoryId = vipCat!.id;

    const { data: walkin } = await admin.from('customers')
      .select('id').eq('phone', '+62811111111').single();
    walkinCustomerId = walkin!.id;
  });

  // Helper — create a draft tablet order + pickup, return orderId in 'draft' status.
  async function createDraftOrder(table: string): Promise<string> {
    await admin.from('products').update({ current_stock: 100 }).eq('id', americanoId);
    const { data: orderId } = await waiterClient.rpc('create_tablet_order', {
      p_waiter_id: waiterId,
      p_table_number: table,
      p_order_type: 'dine_in',
      p_items: [{ product_id: americanoId, quantity: 1, unit_price: americanoPrice, modifiers: [] }],
    });
    await cashierClient.rpc('pickup_tablet_order', { p_order_id: orderId, p_session_id: sessionId });
    return orderId as string;
  }

  // ---------------------------------------------------------------------------
  // §1 Iso-comportement v3 (p_promotions empty/omitted).
  // ---------------------------------------------------------------------------
  describe('iso-comportement v3 (p_promotions empty/omitted)', () => {
    it('omitted p_promotions → orders.promotion_total stays 0, no apps row', async () => {
      const orderId = await createDraftOrder(`T-iso-${Date.now()}`);

      const { error } = await cashierClient.rpc('pay_existing_order', {
        p_order_id: orderId,
        p_payment: { method: 'cash', amount: americanoPrice, cash_received: americanoPrice },
      });
      expect(error).toBeNull();

      const { data: order } = await admin.from('orders')
        .select('total, promotion_total, status').eq('id', orderId).single();
      expect(order!.status).toBe('paid');
      expect(Number(order!.total)).toBe(americanoPrice);
      expect(Number(order!.promotion_total)).toBe(0);

      const { count } = await admin.from('promotion_applications')
        .select('id', { count: 'exact', head: true }).eq('order_id', orderId);
      expect(count).toBe(0);
    });

    it('p_promotions=[] explicit → identical', async () => {
      const orderId = await createDraftOrder(`T-iso2-${Date.now()}`);

      const { error } = await cashierClient.rpc('pay_existing_order', {
        p_order_id: orderId,
        p_payment: { method: 'cash', amount: americanoPrice, cash_received: americanoPrice },
        p_promotions: [],
      });
      expect(error).toBeNull();

      const { data: order } = await admin.from('orders')
        .select('promotion_total').eq('id', orderId).single();
      expect(Number(order!.promotion_total)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // §2 Promotion applied at pickup — orders.promotion_total updated correctly.
  // ---------------------------------------------------------------------------
  describe('promotion applied at pickup', () => {
    let alwaysOnPromoId: string;

    beforeAll(async () => {
      const { data, error } = await admin.from('promotions').insert({
        name: 'Test Pickup Bev 10pct',
        slug: `test-pickup-bev-${Date.now()}`,
        type: 'percentage',
        scope: 'category',
        discount_value: 10,
        scope_category_ids: [beverageCategoryId],
        start_hour: 0, end_hour: 23, day_of_week_mask: 127,
        priority: 100, stackable_with_promo: false,
        is_active: true,
      }).select('id').single();
      if (error) throw error;
      alwaysOnPromoId = data!.id;
    });

    it('orders.promotion_total = SUM(amount) and promotion_applications inserted', async () => {
      const orderId = await createDraftOrder(`T-pay-${Date.now()}`);
      const promoAmount = 3500;
      const expectedTotal = americanoPrice - promoAmount;

      const { error } = await cashierClient.rpc('pay_existing_order', {
        p_order_id: orderId,
        p_payment: { method: 'cash', amount: expectedTotal, cash_received: expectedTotal },
        p_promotions: [
          { promotion_id: alwaysOnPromoId, amount: promoAmount, description: 'Pickup -10%' },
        ],
      });
      expect(error).toBeNull();

      const { data: order } = await admin.from('orders')
        .select('total, promotion_total').eq('id', orderId).single();
      expect(Number(order!.promotion_total)).toBe(promoAmount);
      expect(Number(order!.total)).toBe(expectedTotal);

      const { data: apps } = await admin.from('promotion_applications')
        .select('promotion_id, amount, description').eq('order_id', orderId);
      expect(apps).toHaveLength(1);
      expect(apps![0].promotion_id).toBe(alwaysOnPromoId);
      expect(Number(apps![0].amount)).toBe(promoAmount);
      expect(apps![0].description).toBe('Pickup -10%');
    });
  });

  // ---------------------------------------------------------------------------
  // §3 Server-side check_violation matrix at pickup.
  // ---------------------------------------------------------------------------
  describe('server-side validation — check_violation matrix', () => {
    const callRpc = async (
      promotions: unknown[],
      opts: { customerId?: string | null } = {},
    ) => {
      const orderId = await createDraftOrder(`T-vio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      const args: Record<string, unknown> = {
        p_order_id: orderId,
        p_payment: { method: 'cash', amount: americanoPrice, cash_received: americanoPrice },
        p_promotions: promotions,
      };
      if (opts.customerId !== undefined) args.p_customer_id = opts.customerId;
      return cashierClient.rpc('pay_existing_order', args);
    };

    it('promotion_id not found → check_violation', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000099';
      const { error } = await callRpc([
        { promotion_id: fakeId, amount: 100, description: 'ghost' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('inactive promotion → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Inactive pay', slug: `inactive-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        is_active: false,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 1000, description: 'inactive' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('soft-deleted promotion → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Soft-del pay', slug: `softdel-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5, is_active: true,
      }).select('id').single();
      await admin.from('promotions').update({ deleted_at: new Date().toISOString() }).eq('id', ins!.id);

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 1000, description: 'soft-del' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('start_at in the future → check_violation (not yet active)', async () => {
      const future = new Date(Date.now() + 86400_000).toISOString();
      const farFuture = new Date(Date.now() + 2 * 86400_000).toISOString();
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Future pay', slug: `future-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_at: future, end_at: farFuture, is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 500, description: 'future' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/not yet active/i);
    });

    it('end_at in the past → check_violation (expired)', async () => {
      const past = new Date(Date.now() - 2 * 86400_000).toISOString();
      const recentlyPast = new Date(Date.now() - 86400_000).toISOString();
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Expired pay', slug: `expired-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_at: past, end_at: recentlyPast, is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 500, description: 'expired' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/expired/i);
    });

    it('day_of_week_mask excludes today → check_violation', async () => {
      const localDow = new Date().getDay();
      const todayIsoDow = localDow === 0 ? 7 : localDow;
      const tomorrowIsoDow = (todayIsoDow % 7) + 1;
      const tomorrowOnlyMask = 1 << (tomorrowIsoDow - 1);

      const { data: ins } = await admin.from('promotions').insert({
        name: 'Wrong day pay', slug: `wrongday-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        day_of_week_mask: tomorrowOnlyMask, is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 500, description: 'wrong day' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/not valid this day/i);
    });

    it('current hour out of range → check_violation', async () => {
      // Pick a 1-hour window that's deterministically not "now": 1..2, falling
      // back to 3..4 if it's currently 1:xx.
      const currentHour = new Date().getHours();
      const safeStart = currentHour === 1 ? 3 : 1;
      const safeEnd = safeStart + 1;

      const { data: ins } = await admin.from('promotions').insert({
        name: 'Wrong hour pay', slug: `wronghour-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_hour: safeStart, end_hour: safeEnd, is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 500, description: 'wrong hour' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/not valid this hour/i);
    });

    it('items_total < min_items_total → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'High threshold pay', slug: `highthres-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        min_items_total: 999_999, is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 500, description: 'min total' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/min total not met/i);
    });

    it('customer_category_ids set, p_customer_id NULL → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'VIP only pay', slug: `viponly-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        customer_category_ids: [vipCategoryId], is_active: true,
      }).select('id').single();

      const { error } = await callRpc(
        [{ promotion_id: ins!.id, amount: 500, description: 'no customer' }],
        { customerId: null },
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/requires customer/i);
    });

    it('customer_category mismatch → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'VIP mismatch pay', slug: `vip-mismatch-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        customer_category_ids: [vipCategoryId], is_active: true,
      }).select('id').single();

      // Walkin customer has no category → fails the membership check.
      const { error } = await callRpc(
        [{ promotion_id: ins!.id, amount: 500, description: 'mismatch' }],
        { customerId: walkinCustomerId },
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/not valid for this customer category/i);
    });

    it('negative promotion amount → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Sane pay', slug: `sane-pay-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5, is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: -50, description: 'neg' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/invalid promotion amount/i);
    });
  });
});
