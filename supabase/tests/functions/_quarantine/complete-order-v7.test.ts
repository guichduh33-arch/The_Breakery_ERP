// ⚠️ OBSOLETE — exclusion datée 2026-07-14 (S77, triage nightly live-rpc-vitest).
// Motif : appelle complete_order_with_payment (v1 nu, DROPPÉ live) — money-path courant = complete_order_with_payment_v17 via l'EF process-payment UNIQUEMENT (le POS n'appelle jamais le RPC en direct).
// Réécriture = session dédiée (hors périmètre S77). Exclu du run via vitest.config.ts (**/_quarantine/**).
// Couverture actuelle : ancres pgTAP s44_money_gates / canonical_line_price / combo_sale / combo_fire_pay + vitest process-payment.test.ts (EF).
//
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAsFull } from '../_helpers/auth';

// Session 9 — `complete_order_with_payment` v7 integration tests.
// Spec: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §3.6, §5, §6
// Pattern mirrors functions/complete-order-v3.test.ts (Vitest + pg via supabase-js).
//
// SQLSTATE 23514 = check_violation (Postgres class 23: integrity constraint violation).
const CHECK_VIOLATION = '23514';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('complete_order_with_payment v7 — promotions', () => {
  let admin: ReturnType<typeof createClient>;
  let cashierClient: ReturnType<typeof createClient>;
  let cashierId: string;
  let sessionId: string;
  let americanoId: string;
  let americanoPrice: number;
  let pastryProductId: string;
  let pastryPrice: number;
  let beverageCategoryId: string;
  let walkinCustomerId: string;
  let goldCustomerId: string;
  let vipCategoryId: string;

  const login = async (employeeCode: string, _pin: string) => {
    const r = await loginAsFull(employeeCode);
    return { profileId: r.profileId, accessToken: r.token };
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE);

    // EMP000 = Mamat / SUPER_ADMIN — has all permissions including pos.sale.create.
    const cashier = await login('EMP000', '123456');
    cashierId = cashier.profileId;
    cashierClient = createClient(SUPABASE_URL, SERVICE, {
      global: { headers: { Authorization: `Bearer ${cashier.accessToken}` } },
    });

    // Close any leftover open session for EMP000, open a fresh one.
    await admin.from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: cashierId })
      .eq('opened_by', cashierId).eq('status', 'open');

    const { data: session, error: sessionErr } = await admin.from('pos_sessions')
      .insert({ opened_by: cashierId, opening_cash: 100000 }).select('id').single();
    if (sessionErr || !session) throw new Error(`POS session failed: ${JSON.stringify(sessionErr)}`);
    sessionId = session.id;

    // Resolve catalog: a beverage product (Americano) and a pastry product (Croissant).
    const { data: amer } = await admin.from('products')
      .select('id, retail_price').eq('sku', 'BEV-AMER').single();
    if (!amer) throw new Error('Seed missing BEV-AMER');
    americanoId = amer.id;
    americanoPrice = Number(amer.retail_price);

    const { data: pas } = await admin.from('products')
      .select('id, retail_price').eq('sku', 'PAS-CROI').single();
    if (!pas) throw new Error('Seed missing PAS-CROI');
    pastryProductId = pas.id;
    pastryPrice = Number(pas.retail_price);

    // Replenish stock so test ordering doesn't fail on stock_check.
    await admin.from('products')
      .update({ current_stock: 500 })
      .in('id', [americanoId, pastryProductId]);

    const { data: bevCat } = await admin.from('categories')
      .select('id').eq('slug', 'beverage').single();
    if (!bevCat) throw new Error('Seed missing beverage category');
    beverageCategoryId = bevCat.id;

    // Customer setup (walk-in = no category ; gold = vip category, sufficient points).
    const { data: customers } = await admin.from('customers')
      .select('id, phone').in('phone', ['+62811111111', '+62833333333']);
    if (!customers?.length) throw new Error('Demo customers not seeded — run supabase db reset');
    walkinCustomerId = customers.find(c => c.phone === '+62811111111')!.id;
    goldCustomerId = customers.find(c => c.phone === '+62833333333')!.id;

    const { data: vipCat } = await admin.from('customer_categories')
      .select('id').eq('slug', 'vip').single();
    if (!vipCat) throw new Error('Seed missing vip customer category');
    vipCategoryId = vipCat.id;

    // Make sure goldCustomer is in the VIP category for customer-restricted tests.
    await admin.from('customers')
      .update({ category_id: vipCategoryId, loyalty_points: 0, lifetime_points: 0 })
      .eq('id', goldCustomerId);
  });

  // ---------------------------------------------------------------------------
  // §1 Iso-comportement v6 — p_promotions omitted/empty/null behaves identically.
  // ---------------------------------------------------------------------------
  describe('iso-comportement v6 (p_promotions empty/omitted)', () => {
    it('p_promotions omitted: 3-item cart → no promotion_applications, promotion_total=0', async () => {
      await admin.from('products').update({ current_stock: 100 })
        .in('id', [americanoId, pastryProductId]);

      const items = [
        { product_id: americanoId,   quantity: 1, unit_price: americanoPrice },
        { product_id: americanoId,   quantity: 1, unit_price: americanoPrice },
        { product_id: pastryProductId, quantity: 1, unit_price: pastryPrice },
      ];
      const itemsTotal = americanoPrice * 2 + pastryPrice;

      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id: sessionId,
        p_order_type: 'take_out',
        p_items: items,
        p_payment: { method: 'cash', amount: itemsTotal, cash_received: itemsTotal },
      });

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(Number(data.subtotal)).toBe(itemsTotal);
      expect(Number(data.total)).toBe(itemsTotal);
      expect(Number(data.promotion_total)).toBe(0);

      const { data: order } = await admin.from('orders')
        .select('promotion_total, total, subtotal').eq('id', data.order_id).single();
      expect(Number(order!.promotion_total)).toBe(0);
      expect(Number(order!.total)).toBe(itemsTotal);

      const { data: apps } = await admin.from('promotion_applications')
        .select('id').eq('order_id', data.order_id);
      expect(apps).toEqual([]);

      // order_items default flags preserved (is_promo_gift=false, promotion_id=null).
      const { data: oitems } = await admin.from('order_items')
        .select('is_promo_gift, promotion_id').eq('order_id', data.order_id);
      expect(oitems).toHaveLength(3);
      expect(oitems!.every(i => i.is_promo_gift === false && i.promotion_id === null)).toBe(true);
    });

    it('p_promotions = [] explicit: same v6 totals, no apps inserted', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', americanoId);

      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id: sessionId,
        p_order_type: 'take_out',
        p_items: [{ product_id: americanoId, quantity: 1, unit_price: americanoPrice }],
        p_payment: { method: 'cash', amount: americanoPrice, cash_received: americanoPrice },
        p_promotions: [],
      });
      expect(error).toBeNull();
      expect(Number(data.promotion_total)).toBe(0);

      const { count } = await admin.from('promotion_applications')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', data.order_id);
      expect(count).toBe(0);
    });

    it('p_promotions = null explicit: same v6 totals', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', americanoId);

      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id: sessionId,
        p_order_type: 'take_out',
        p_items: [{ product_id: americanoId, quantity: 1, unit_price: americanoPrice }],
        p_payment: { method: 'cash', amount: americanoPrice, cash_received: americanoPrice },
        p_promotions: null,
      });
      expect(error).toBeNull();
      expect(Number(data.promotion_total)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // §2 Happy-Hour application — wide-hour-range workaround.
  //
  // We can't reliably mock now() in Postgres without a clock helper. So we seed
  // a fresh percentage promo with start_hour=0, end_hour=23 (always-on for the
  // test) and day_of_week_mask=127. This validates the apply path (insert,
  // promotion_total, math) without depending on wall-clock time.
  // ---------------------------------------------------------------------------
  describe('promotion apply — happy path', () => {
    let alwaysOnPromoId: string;

    beforeAll(async () => {
      const { data, error } = await admin.from('promotions').insert({
        name: 'Test Always-On Beverage 10pct',
        slug: `test-always-on-bev-${Date.now()}`,
        description: 'Test promo — wide hour range to bypass clock-mock',
        type: 'percentage',
        scope: 'category',
        discount_value: 10,
        scope_category_ids: [beverageCategoryId],
        start_hour: 0,
        end_hour: 23,
        day_of_week_mask: 127,
        priority: 100,
        stackable_with_promo: false,
        is_active: true,
      }).select('id').single();
      if (error) throw error;
      alwaysOnPromoId = data!.id;
    });

    it('applies 3,500 promotion on a beverage line and inserts promotion_applications', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', americanoId);

      const items = [{ product_id: americanoId, quantity: 1, unit_price: americanoPrice }];
      const promoAmount = 3500;
      const expectedTotal = americanoPrice - promoAmount;

      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id: sessionId,
        p_order_type: 'take_out',
        p_items: items,
        p_payment: { method: 'cash', amount: expectedTotal, cash_received: expectedTotal },
        p_promotions: [
          { promotion_id: alwaysOnPromoId, amount: promoAmount, description: 'Test Beverage -10%' },
        ],
      });

      expect(error).toBeNull();
      expect(Number(data.subtotal)).toBe(americanoPrice);
      expect(Number(data.promotion_total)).toBe(promoAmount);
      expect(Number(data.total)).toBe(expectedTotal);

      const { data: order } = await admin.from('orders')
        .select('promotion_total, subtotal, total').eq('id', data.order_id).single();
      expect(Number(order!.promotion_total)).toBe(promoAmount);
      expect(Number(order!.total)).toBe(expectedTotal);

      const { data: apps } = await admin.from('promotion_applications')
        .select('promotion_id, amount, description').eq('order_id', data.order_id);
      expect(apps).toHaveLength(1);
      expect(apps![0].promotion_id).toBe(alwaysOnPromoId);
      expect(Number(apps![0].amount)).toBe(promoAmount);
      expect(apps![0].description).toBe('Test Beverage -10%');
    });
  });

  // ---------------------------------------------------------------------------
  // §3 Server-side check_violation matrix.
  // ---------------------------------------------------------------------------
  describe('server-side validation — check_violation matrix', () => {
    const baseCart = () => [{ product_id: americanoId, quantity: 1, unit_price: americanoPrice }];

    const callRpc = async (promotions: unknown[], opts: { customerId?: string | null } = {}) => {
      await admin.from('products').update({ current_stock: 50 }).eq('id', americanoId);
      const args: Record<string, unknown> = {
        p_session_id: sessionId,
        p_order_type: 'take_out',
        p_items: baseCart(),
        p_payment: { method: 'cash', amount: americanoPrice, cash_received: americanoPrice },
        p_promotions: promotions,
      };
      if (opts.customerId !== undefined) args.p_customer_id = opts.customerId;
      return cashierClient.rpc('complete_order_with_payment', args);
    };

    it('promotion_id not found → check_violation', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000099';
      const { error } = await callRpc([
        { promotion_id: fakeId, amount: 100, description: 'ghost' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/not found or inactive/i);
    });

    it('soft-deleted promotion → check_violation', async () => {
      const { data: insert } = await admin.from('promotions').insert({
        name: 'Soft-deleted test', slug: `softdel-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        is_active: true,
      }).select('id').single();
      // soft-delete it
      await admin.from('promotions').update({ deleted_at: new Date().toISOString() }).eq('id', insert!.id);

      const { error } = await callRpc([
        { promotion_id: insert!.id, amount: 1000, description: 'soft-deleted' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('inactive promotion → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Inactive test', slug: `inactive-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        is_active: false,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 1000, description: 'inactive' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('start_at in the future (not yet active) → check_violation', async () => {
      const future = new Date(Date.now() + 86400_000).toISOString();
      const farFuture = new Date(Date.now() + 2 * 86400_000).toISOString();
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Future start', slug: `future-start-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_at: future, end_at: farFuture,
        is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 1000, description: 'future' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/not yet active/i);
    });

    it('end_at in the past (expired) → check_violation', async () => {
      const past = new Date(Date.now() - 2 * 86400_000).toISOString();
      const recentlyPast = new Date(Date.now() - 86400_000).toISOString();
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Expired', slug: `expired-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_at: past, end_at: recentlyPast,
        is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 1000, description: 'expired' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/expired/i);
    });

    it('day_of_week_mask excludes today → check_violation', async () => {
      // Compute today's ISODOW (1=Mon..7=Sun) and build a mask without it.
      const isoDow = (() => {
        const d = new Date().getUTCDay(); // 0=Sun..6=Sat (UTC)
        // Use server time approximation: the RPC uses now() server-side. To avoid
        // timezone surprises we test by submitting a mask of 1 (Monday only) AND
        // a mask of 64 (Sunday only) and assert one of them fails. That's brittle.
        // Better approach: use a mask that excludes ALL days (mask=0 disallowed
        // by chk_promotion_day_of_week_mask >=0). So pick mask = bit for an
        // arbitrarily chosen day that's NOT today (server-side).
        // Simpler: check what server thinks today is via a tiny RPC call — but
        // there's no public helper. Instead, exclude ALL days except an
        // impossible "next month's Monday at exact same minute" — which we
        // approximate by toggling each bit and asserting at least one fails.
        return d;
      })();
      // Local strategy: pick today's ISO DOW client-side as approximation.
      // Container/server are usually +08:00 (Asia/Makassar) for this project.
      // We submit a mask that ONLY has tomorrow's bit set (relative to local now).
      const localDow = new Date().getDay(); // 0=Sun..6=Sat
      // Convert to ISODOW (1=Mon..7=Sun): if Sun (0) → 7 ; else (Mon..Sat) → localDow.
      const todayIsoDow = localDow === 0 ? 7 : localDow;
      const tomorrowIsoDow = (todayIsoDow % 7) + 1;
      const tomorrowOnlyMask = 1 << (tomorrowIsoDow - 1); // bits 0..6

      const { data: ins } = await admin.from('promotions').insert({
        name: 'Wrong day', slug: `wrongday-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        day_of_week_mask: tomorrowOnlyMask,
        is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 500, description: 'wrong day' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/not valid this day/i);
    });

    it('start_hour..end_hour excludes current hour → check_violation', async () => {
      // We pick a 1-hour window in the past (e.g. midnight 0..1 if it's not 00:xx).
      const now = new Date();
      const currentHour = now.getHours();
      // Choose a window 2..3 hours that excludes currentHour.
      const startHour = (currentHour + 4) % 24;
      let endHour = (startHour + 1) % 24;
      // Constraint chk_promotion_hour_range requires start_hour < end_hour.
      // If our +4 wraps past 23, push to safe window 0..1.
      if (startHour >= 23) {
        // pick 0..1 unless current is 0
        if (currentHour === 0) {
          // shouldn't happen in practice but guard: pick 4..5 then.
          endHour = 5; // re-assign
        }
      }
      // Re-pick a deterministic-safe window: 1..2 if currentHour != 1, else 3..4.
      const safeStart = currentHour === 1 ? 3 : 1;
      const safeEnd = safeStart + 1;

      const { data: ins } = await admin.from('promotions').insert({
        name: 'Wrong hour', slug: `wronghour-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_hour: safeStart, end_hour: safeEnd,
        is_active: true,
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
        name: 'High threshold', slug: `highthreshold-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        min_items_total: 999_999,
        is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: 500, description: 'min total' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/min total not met/i);
    });

    it('customer_category_ids set but p_customer_id NULL → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'VIP only', slug: `viponly-no-customer-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        customer_category_ids: [vipCategoryId],
        is_active: true,
      }).select('id').single();

      const { error } = await callRpc(
        [{ promotion_id: ins!.id, amount: 500, description: 'VIP-no-customer' }],
        { customerId: null },
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/requires customer/i);
    });

    it('customer_category_ids set but customer not in list → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'VIP only mismatch', slug: `viponly-mismatch-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        customer_category_ids: [vipCategoryId],
        is_active: true,
      }).select('id').single();

      // walkin customer has no category → should fail.
      const { error } = await callRpc(
        [{ promotion_id: ins!.id, amount: 500, description: 'VIP-mismatch' }],
        { customerId: walkinCustomerId },
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/not valid for this customer category/i);
    });

    it('negative promotion amount → check_violation', async () => {
      const { data: ins } = await admin.from('promotions').insert({
        name: 'Sane promo', slug: `sane-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        is_active: true,
      }).select('id').single();

      const { error } = await callRpc([
        { promotion_id: ins!.id, amount: -100, description: 'negative' },
      ]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/invalid promotion amount/i);
    });
  });

  // ---------------------------------------------------------------------------
  // §4 Free-product gift line — items pass-through with is_promo_gift=true.
  // ---------------------------------------------------------------------------
  describe('free-product gift item pass-through', () => {
    let giftPromoId: string;

    beforeAll(async () => {
      const { data } = await admin.from('promotions').insert({
        name: 'Test Free Gift', slug: `test-free-gift-${Date.now()}`,
        description: 'Test free product',
        type: 'free_product',
        gift_product_id: pastryProductId,
        gift_qty: 1,
        is_active: true,
        // No customer/min restrictions to keep the apply path simple.
      }).select('id').single();
      giftPromoId = data!.id;
    });

    it('preserves is_promo_gift=true + promotion_id on the gift order_item row', async () => {
      await admin.from('products').update({ current_stock: 100 })
        .in('id', [americanoId, pastryProductId]);

      const items = [
        { product_id: americanoId, quantity: 1, unit_price: americanoPrice },
        // Free gift line: unit_price=0, flagged.
        {
          product_id: pastryProductId, quantity: 1, unit_price: 0,
          is_promo_gift: true, promotion_id: giftPromoId,
        },
      ];

      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id: sessionId,
        p_order_type: 'take_out',
        p_items: items,
        p_payment: { method: 'cash', amount: americanoPrice, cash_received: americanoPrice },
      });

      expect(error).toBeNull();
      expect(Number(data.subtotal)).toBe(americanoPrice); // gift contributes 0 to items_total

      const { data: oitems } = await admin.from('order_items')
        .select('product_id, unit_price, line_total, is_promo_gift, promotion_id')
        .eq('order_id', data.order_id);
      expect(oitems).toHaveLength(2);

      const giftRow = oitems!.find(i => i.product_id === pastryProductId);
      expect(giftRow).toBeDefined();
      expect(giftRow!.is_promo_gift).toBe(true);
      expect(giftRow!.promotion_id).toBe(giftPromoId);
      expect(Number(giftRow!.unit_price)).toBe(0);
      expect(Number(giftRow!.line_total)).toBe(0);

      const paidRow = oitems!.find(i => i.product_id === americanoId);
      expect(paidRow!.is_promo_gift).toBe(false);
      expect(paidRow!.promotion_id).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // §5 Total math — tax recompute and discount/redemption interaction.
  // ---------------------------------------------------------------------------
  describe('total math: items - redemption - discount - promotion = total', () => {
    let promoId: string;

    beforeAll(async () => {
      const { data } = await admin.from('promotions').insert({
        name: 'Test Math Cart 5pct', slug: `test-math-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_hour: 0, end_hour: 23, day_of_week_mask: 127,
        is_active: true,
      }).select('id').single();
      promoId = data!.id;
    });

    it('total = items - manual_discount - promotion_total ; tax = round_idr(total*0.1/1.1)', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', americanoId);

      // 4 x Americano 35,000 = 140,000
      const qty = 4;
      const itemsTotal = americanoPrice * qty;
      const manualDiscount = 5_000;
      const promoAmount = 7_000;
      const expectedTotal = itemsTotal - manualDiscount - promoAmount;
      // tax-inclusive PB1: tax = round_idr(total * 0.10 / 1.10) — round_idr = round to nearest 100.
      const roundIdr = (n: number) => Math.round(n / 100) * 100;
      const expectedTax = roundIdr((expectedTotal * 0.10) / 1.10);

      const { data, error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id: sessionId,
        p_order_type: 'take_out',
        p_items: [{ product_id: americanoId, quantity: qty, unit_price: americanoPrice }],
        p_payment: { method: 'cash', amount: expectedTotal, cash_received: expectedTotal },
        p_discount_amount: manualDiscount,
        p_discount_type: 'fixed_amount',
        p_discount_value: manualDiscount,
        p_discount_reason: 'Test combo',
        p_promotions: [
          { promotion_id: promoId, amount: promoAmount, description: 'Test 5%' },
        ],
      });

      expect(error).toBeNull();
      expect(Number(data.subtotal)).toBe(itemsTotal);
      expect(Number(data.promotion_total)).toBe(promoAmount);
      expect(Number(data.discount_amount)).toBe(manualDiscount);
      expect(Number(data.total)).toBe(expectedTotal);
      // Tax should be recomputed on post-promo total (P16).
      expect(Number(data.tax_amount)).toBe(expectedTax);
    });

    it('rejects when discount + promotion exceed items total → check_violation', async () => {
      await admin.from('products').update({ current_stock: 100 }).eq('id', americanoId);

      const { error } = await cashierClient.rpc('complete_order_with_payment', {
        p_session_id: sessionId,
        p_order_type: 'take_out',
        p_items: [{ product_id: americanoId, quantity: 1, unit_price: americanoPrice }],
        p_payment: { method: 'cash', amount: 0, cash_received: 0 },
        p_discount_amount: americanoPrice / 2,
        p_promotions: [
          { promotion_id: promoId, amount: americanoPrice, description: 'overcap' },
        ],
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
      expect(error!.message).toMatch(/exceed items total/i);
    });
  });
});
