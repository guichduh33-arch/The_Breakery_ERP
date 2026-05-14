// supabase/tests/functions/promotions-evaluate-v1.test.ts
// Session 13 / Phase 2.C — live Vitest integration for `evaluate_promotions_v1`.
//
// Runs against staging `ikcyvlovptebroadgtvd`. Uses PIN-login to obtain a
// JWT and calls the RPC through the same auth path the POS uses.
//
// Coverage:
//   T_LIVE_01: BOGO new shape — 3 baguettes ⇒ free_items contains 1.
//   T_LIVE_02: Threshold subtotal 100k @ 10% ⇒ discount 15k on 150k cart.
//   T_LIVE_03: Bundle 3 products → fixed price ⇒ discount = matched − price.
//
// Fixtures are inserted with `is_active=false` for all promos except the
// one under test, then re-toggled per test. We deactivate all
// `is_active=true` promos in the DB during setup and restore at teardown.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON =
  process.env.SUPABASE_ANON_KEY
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
  const body = await res.json() as { auth?: { access_token?: string } };
  if (!body.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.auth.access_token;
}

function jwtClient(token: string) {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

interface AppliedPromotionResult {
  promotion_id: string;
  slug: string;
  name: string;
  type: string;
  discount_amount: number;
  free_items?: { product_id: string; quantity: number }[];
}

interface EvaluatePromotionsV1Result {
  applied_promotions: AppliedPromotionResult[];
  subtotal_before: number;
  subtotal_after_discount: number;
  total_discount: number;
}

describe('evaluate_promotions_v1 RPC — live', () => {
  let token: string;
  let originalActiveSlugs: string[] = [];
  let productAId: string;
  let productBId: string;
  let productCId: string;
  let productDId: string;

  beforeAll(async () => {
    token = await loginAs('EMP000', '123456');
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Snapshot active promos so we can restore at end.
    const { data: active } = await admin
      .from('promotions')
      .select('slug')
      .eq('is_active', true)
      .is('deleted_at', null);
    originalActiveSlugs = (active ?? []).map((r) => r.slug);

    // Disable all production promos for the duration.
    await admin
      .from('promotions')
      .update({ is_active: false })
      .eq('is_active', true);

    // Insert a temp category + 4 products with known prices.
    const { data: cat } = await admin
      .from('categories')
      .insert({ name: 'PHASE2C-LIVE', slug: 'phase-2c-live' })
      .select('id')
      .single();
    const catId = cat!.id;

    const { data: prods } = await admin
      .from('products')
      .insert([
        { sku: 'P2C-A', name: 'Phase2C A 15k', retail_price: 15000, category_id: catId, unit: 'unit' },
        { sku: 'P2C-B', name: 'Phase2C B 20k', retail_price: 20000, category_id: catId, unit: 'unit' },
        { sku: 'P2C-C', name: 'Phase2C C 25k', retail_price: 25000, category_id: catId, unit: 'unit' },
        { sku: 'P2C-D', name: 'Phase2C D 25k', retail_price: 25000, category_id: catId, unit: 'unit' },
      ])
      .select('id, sku');
    productAId = prods!.find((p) => p.sku === 'P2C-A')!.id;
    productBId = prods!.find((p) => p.sku === 'P2C-B')!.id;
    productCId = prods!.find((p) => p.sku === 'P2C-C')!.id;
    productDId = prods!.find((p) => p.sku === 'P2C-D')!.id;

    // Insert three test promotions, only one active at a time.
    await admin.from('promotions').insert([
      {
        name: 'Live BOGO 2+1 Baguette',
        slug: 'live-bogo-2-1-baguette',
        type: 'bogo',
        bogo_buy_quantity: 2,
        bogo_get_quantity: 1,
        bogo_get_product_id: productAId,
        bogo_trigger_product_ids: [productAId],
        priority: 100,
        is_active: false,
      },
      {
        name: 'Live Threshold 100k @ 10%',
        slug: 'live-threshold-100k-10',
        type: 'threshold',
        threshold_amount: 100000,
        threshold_type: 'subtotal',
        discount_value: 10,
        max_discount_amount: 50000,
        priority: 80,
        is_active: false,
      },
      {
        name: 'Live Bundle B+C+D 50k',
        slug: 'live-bundle-bcd-50k',
        type: 'bundle',
        bundle_product_ids: [productBId, productCId, productDId],
        bundle_price: 50000,
        priority: 60,
        is_active: false,
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    // Remove test promos.
    await admin
      .from('promotions')
      .delete()
      .in('slug', ['live-bogo-2-1-baguette', 'live-threshold-100k-10', 'live-bundle-bcd-50k']);
    // Remove test products.
    await admin.from('products').delete().in('sku', ['P2C-A', 'P2C-B', 'P2C-C', 'P2C-D']);
    // Remove test category.
    await admin.from('categories').delete().eq('slug', 'phase-2c-live');
    // Restore original active set.
    if (originalActiveSlugs.length > 0) {
      await admin.from('promotions').update({ is_active: true }).in('slug', originalActiveSlugs);
    }
  }, 30_000);

  it('T_LIVE_01: BOGO new shape — 3 baguettes ⇒ 1 free + 15k discount', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('promotions').update({ is_active: false }).like('slug', 'live-%');
    await admin.from('promotions').update({ is_active: true }).eq('slug', 'live-bogo-2-1-baguette');

    const sb = jwtClient(token);
    const { data, error } = await sb.rpc('evaluate_promotions_v1', {
      p_cart_items: [
        { line_id: 'L1', product_id: productAId, quantity: 3, unit_price: 15000 },
      ],
      p_subtotal: 45000,
    });
    expect(error).toBeNull();
    const result = data as unknown as EvaluatePromotionsV1Result;
    expect(result.applied_promotions).toHaveLength(1);
    expect(result.applied_promotions[0]!.type).toBe('bogo');
    expect(result.applied_promotions[0]!.discount_amount).toBe(15000);
    expect(result.applied_promotions[0]!.free_items).toEqual([
      { product_id: productAId, quantity: 1 },
    ]);
    expect(result.total_discount).toBe(15000);
  });

  it('T_LIVE_02: Threshold subtotal — 150k cart @ 10% ⇒ 15k discount', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('promotions').update({ is_active: false }).like('slug', 'live-%');
    await admin.from('promotions').update({ is_active: true }).eq('slug', 'live-threshold-100k-10');

    const sb = jwtClient(token);
    const { data, error } = await sb.rpc('evaluate_promotions_v1', {
      p_cart_items: [
        { line_id: 'L1', product_id: productBId, quantity: 3, unit_price: 50000 },
      ],
      p_subtotal: 150000,
    });
    expect(error).toBeNull();
    const result = data as unknown as EvaluatePromotionsV1Result;
    expect(result.applied_promotions).toHaveLength(1);
    expect(result.applied_promotions[0]!.type).toBe('threshold');
    expect(result.applied_promotions[0]!.discount_amount).toBe(15000);
    expect(result.total_discount).toBe(15000);
    expect(result.subtotal_after_discount).toBe(135000);
  });

  it('T_LIVE_03: Bundle — [B,C,D] = 70k, bundle_price 50k ⇒ 20k discount', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('promotions').update({ is_active: false }).like('slug', 'live-%');
    await admin.from('promotions').update({ is_active: true }).eq('slug', 'live-bundle-bcd-50k');

    const sb = jwtClient(token);
    const { data, error } = await sb.rpc('evaluate_promotions_v1', {
      p_cart_items: [
        { line_id: 'L1', product_id: productBId, quantity: 1, unit_price: 20000 },
        { line_id: 'L2', product_id: productCId, quantity: 1, unit_price: 25000 },
        { line_id: 'L3', product_id: productDId, quantity: 1, unit_price: 25000 },
      ],
    });
    expect(error).toBeNull();
    const result = data as unknown as EvaluatePromotionsV1Result;
    expect(result.applied_promotions).toHaveLength(1);
    expect(result.applied_promotions[0]!.type).toBe('bundle');
    expect(result.applied_promotions[0]!.discount_amount).toBe(20000);
    expect(result.total_discount).toBe(20000);
  });
});
