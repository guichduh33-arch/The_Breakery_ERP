// supabase/tests/functions/recipe-cycle-rejection.test.ts
// Session 15 / Phase 1.C — Live integration tests for the
// `validate_recipe_no_cycle` BEFORE INSERT/UPDATE trigger on `recipes`.
//
// Coverage :
//   - Direct cycle  A→B then B→A → P0001 recipe_cycle_detected.
//   - Indirect cycle A→B→C then C→A → P0001 recipe_cycle_detected.
//   - Self-loop A→A → rejected by table CHECK constraint
//     `recipes_product_material_distinct` (the trigger never sees this case).
//   - Soft-deleted A→B + new active B→A → SUCCESS (the inactive row is
//     excluded from the trigger's descendant walk).
//
// Skips gracefully when env vars are missing. Cleanup in afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? '';

const liveCfg = !!SUPABASE_URL && !!SERVICE && !!ANON;
const describeLive = liveCfg ? describe : describe.skip;

interface ProdRow { id: string; sku: string; }

const SKU_PREFIX = 'S15-CYC';
const allSkus: string[] = [];

async function mkProduct(admin: SupabaseClient, sku: string): Promise<ProdRow> {
  await admin.from('products').delete().eq('sku', sku);
  const { data: cat } = await admin.from('categories').select('id').limit(1).single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
  const { data, error } = await admin.from('products').insert({
    sku, name: sku,
    category_id: (cat as { id: string }).id,
    retail_price: 1000, current_stock: 0, unit: 'pcs',
    cost_price: 100, product_type: 'finished', is_active: true,
  } as any).select('id, sku').single();
  if (error || !data) throw new Error(`mkProduct(${sku}): ${error?.message}`);
  return data as ProdRow;
}

async function cleanupAll(admin: SupabaseClient) {
  if (allSkus.length === 0) return;
  const { data: prods } = await admin.from('products').select('id').in('sku', allSkus);
  const ids = (prods ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return;
  await admin.from('recipes').delete().in('product_id', ids);
  await admin.from('recipes').delete().in('material_id', ids);
  await admin.from('products').delete().in('id', ids);
}

describeLive('validate_recipe_no_cycle — live trigger integration', () => {
  let managerToken: string;
  let admin: SupabaseClient;

  beforeAll(async () => {
    managerToken = await loginAs('EMP000', '111111');
    admin = createClient(SUPABASE_URL, SERVICE);
  }, 30_000);

  afterAll(async () => {
    if (liveCfg) await cleanupAll(admin);
  });

  it('direct cycle A->B + B->A is rejected with P0001', async () => {
    const a = await mkProduct(admin, `${SKU_PREFIX}-DIR-A`);
    const b = await mkProduct(admin, `${SKU_PREFIX}-DIR-B`);
    allSkus.push(a.sku, b.sku);

    const mgr = jwtClient(managerToken);
    const r1 = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: a.id, p_material_id: b.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    expect(r1.error).toBeNull();

    const r2 = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: b.id, p_material_id: a.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    expect(r2.error).not.toBeNull();
    expect(r2.error?.message ?? '').toMatch(/recipe_cycle_detected/);
    expect(r2.error?.code).toBe('P0001');
  });

  it('indirect cycle A->B->C + C->A is rejected with P0001', async () => {
    const a = await mkProduct(admin, `${SKU_PREFIX}-IND-A`);
    const b = await mkProduct(admin, `${SKU_PREFIX}-IND-B`);
    const c = await mkProduct(admin, `${SKU_PREFIX}-IND-C`);
    allSkus.push(a.sku, b.sku, c.sku);

    const mgr = jwtClient(managerToken);
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: a.id, p_material_id: b.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: b.id, p_material_id: c.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();

    const r3 = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: c.id, p_material_id: a.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    expect(r3.error).not.toBeNull();
    expect(r3.error?.message ?? '').toMatch(/recipe_cycle_detected/);
    expect(r3.error?.code).toBe('P0001');
  });

  it('self-loop A->A is rejected (table CHECK precedes trigger)', async () => {
    const a = await mkProduct(admin, `${SKU_PREFIX}-SELF-A`);
    allSkus.push(a.sku);

    const mgr = jwtClient(managerToken);
    // upsert_recipe_v1 has its own guard `material_must_differ_from_product`
    // that fires before reaching the table. Both surfaces (RPC guard OR
    // table CHECK) must reject.
    const r = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: a.id, p_material_id: a.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    expect(r.error).not.toBeNull();
    expect(r.error?.message ?? '').toMatch(/material_must_differ_from_product|recipes_product_material_distinct/);
  });

  it('soft-deleted A->B does NOT block subsequent B->A insert', async () => {
    const a = await mkProduct(admin, `${SKU_PREFIX}-SOFT-A`);
    const b = await mkProduct(admin, `${SKU_PREFIX}-SOFT-B`);
    allSkus.push(a.sku, b.sku);

    const mgr = jwtClient(managerToken);
    const r1 = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: a.id, p_material_id: b.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    expect(r1.error).toBeNull();
    const recipeId = r1.data as string;

    // Soft-delete via the canonical RPC (UPDATE is_active=false + deleted_at).
    const rdel = await mgr.rpc('deactivate_recipe_v1', { p_recipe_id: recipeId });
    expect(rdel.error).toBeNull();

    // Now B→A : the soft-deleted A→B is excluded from the descendant walk,
    // so no cycle is detected.
    const r2 = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: b.id, p_material_id: a.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    expect(r2.error).toBeNull();
  });
});
