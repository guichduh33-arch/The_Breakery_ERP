// supabase/tests/functions/recipe-calculate-cost.test.ts
// Session 15 / Phase 1.C — Live integration tests for calculate_recipe_cost_v1.
//
// Coverage :
//   - Happy path : flat recipe with 2 leaf materials returns sum-of-products.
//   - 2-level cascade : intermediate sub-recipe → sub_breakdown present,
//     depth_reached >= 2.
//   - 7-level chain rejected upstream by the cycle trigger (the depth gate is
//     the BEFORE INSERT cycle trigger itself ; the cost RPC's internal walker
//     has a 5-level cap that mirrors the trigger). See deviation pack
//     D-S15-1A-DEPTH-01.
//
// Skips gracefully when env vars are missing (CI dry-run on local without
// Supabase credentials). Mirrors the inventory-f1-lots / inventory-production
// test patterns. Cleanup via service-role hard-delete in `afterAll`.

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

async function mkProduct(
  admin: SupabaseClient,
  sku: string,
  name: string,
  unit: string,
  cost: number,
): Promise<ProdRow> {
  // Cleanup any leftover from a previous run.
  await admin.from('products').delete().eq('sku', sku);

  const { data: cat } = await admin.from('categories').select('id').limit(1).single();
  if (!cat) throw new Error('No category seeded');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
  const { data, error } = await admin.from('products').insert({
    sku, name,
    category_id: (cat as { id: string }).id,
    retail_price: 1000,
    current_stock: 0,
    unit,
    cost_price: cost,
    product_type: 'finished',
    is_active: true,
  } as any).select('id, sku').single();
  if (error || !data) throw new Error(`mkProduct(${sku}) failed: ${error?.message}`);
  return data as ProdRow;
}

const SKU_PREFIX = 'S15-RCC';   // recipe-calc-cost
const allSkus: string[] = [];

async function cleanupAll(admin: SupabaseClient) {
  if (allSkus.length === 0) return;
  // Delete recipes first (FK ON DELETE RESTRICT for material_id).
  const { data: prods } = await admin.from('products')
    .select('id').in('sku', allSkus);
  const ids = (prods ?? []).map((r: { id: string }) => r.id);
  if (ids.length > 0) {
    await admin.from('recipes').delete().in('product_id', ids);
    await admin.from('recipes').delete().in('material_id', ids);
    await admin.from('products').delete().in('id', ids);
  }
}

describeLive('calculate_recipe_cost_v1 — live integration', () => {
  let managerToken: string;
  let admin: SupabaseClient;

  beforeAll(async () => {
    managerToken = await loginAs('EMP000', '111111'); // admin has inventory.read
    admin = createClient(SUPABASE_URL, SERVICE);
  }, 30_000);

  afterAll(async () => {
    if (liveCfg) await cleanupAll(admin);
  });

  it('happy path: flat recipe returns cost_per_unit + breakdown', async () => {
    const fin = await mkProduct(admin, `${SKU_PREFIX}-FLAT-FIN`, 'flat finished', 'pcs', 0);
    const m1  = await mkProduct(admin, `${SKU_PREFIX}-FLAT-M1`,  'flat mat1',     'pcs', 200);
    const m2  = await mkProduct(admin, `${SKU_PREFIX}-FLAT-M2`,  'flat mat2',     'pcs', 500);
    allSkus.push(fin.sku, m1.sku, m2.sku);

    const mgr = jwtClient(managerToken);
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: fin.id, p_material_id: m1.id, p_quantity: 3, p_unit: 'pcs', p_notes: null,
    });
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: fin.id, p_material_id: m2.id, p_quantity: 2, p_unit: 'pcs', p_notes: null,
    });

    const { data, error } = await mgr.rpc('calculate_recipe_cost_v1', {
      p_product_id: fin.id, p_max_depth: 5,
    });
    expect(error).toBeNull();
    const result = data as {
      product_id: string;
      cost_per_unit: number;
      breakdown: { is_recipe: boolean; subtotal: number }[];
      depth_reached: number;
      has_cycle: boolean;
    };
    expect(result.product_id).toBe(fin.id);
    expect(Number(result.cost_per_unit)).toBe(1600); // 3*200 + 2*500
    expect(result.breakdown).toHaveLength(2);
    expect(result.has_cycle).toBe(false);
    expect(result.depth_reached).toBeGreaterThanOrEqual(1);
  });

  it('2-level cascade: returns sub_breakdown with depth_reached >= 2', async () => {
    const ly  = await mkProduct(admin, `${SKU_PREFIX}-CAS-LY`,  'cascade leaf Y',  'pcs', 100);
    const lx  = await mkProduct(admin, `${SKU_PREFIX}-CAS-LX`,  'cascade leaf X',  'pcs', 300);
    const int = await mkProduct(admin, `${SKU_PREFIX}-CAS-INT`, 'cascade intermed','pcs', 0);
    const fin = await mkProduct(admin, `${SKU_PREFIX}-CAS-FIN`, 'cascade finished','pcs', 0);
    allSkus.push(ly.sku, lx.sku, int.sku, fin.sku);

    const mgr = jwtClient(managerToken);
    // INT := 2 LY  (so INT unit cost = 200)
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: int.id, p_material_id: ly.id, p_quantity: 2, p_unit: 'pcs', p_notes: null,
    });
    // FIN := 1 INT + 1 LX
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: fin.id, p_material_id: int.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: fin.id, p_material_id: lx.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });

    const { data, error } = await mgr.rpc('calculate_recipe_cost_v1', {
      p_product_id: fin.id, p_max_depth: 5,
    });
    expect(error).toBeNull();
    const result = data as {
      cost_per_unit: number;
      breakdown: { is_recipe: boolean; sub_breakdown?: unknown[] }[];
      depth_reached: number;
    };
    expect(Number(result.cost_per_unit)).toBe(500); // 1*200 + 1*300
    expect(result.depth_reached).toBeGreaterThanOrEqual(2);
    const recipeLine = result.breakdown.find(l => l.is_recipe === true);
    expect(recipeLine).toBeDefined();
    expect(recipeLine?.sub_breakdown).toBeDefined();
    expect(Array.isArray(recipeLine?.sub_breakdown)).toBe(true);
  });

  it('depth exceeded: 7-level chain blocked by BEFORE INSERT cycle trigger', async () => {
    // Build chain bottom-up via direct admin INSERT so each individual edge's
    // descendant walk is small enough to pass the trigger ; the FINAL TOP→P2
    // attempt has a 6-deep descendant walk and must be rejected with P0001.
    const ids: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const p = await mkProduct(admin, `${SKU_PREFIX}-DEEP-${i}`, `deep p${i}`, 'pcs', 100);
      ids.push(p.id);
      allSkus.push(p.sku);
    }

    // Bottom-up : P7→P8, P6→P7, ..., P2→P3 (6 edges)
    for (let i = 7; i >= 2; i--) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
      const { error } = await admin.from('recipes').insert({
        product_id: ids[i - 1], material_id: ids[i], quantity: 1, unit: 'pcs', is_active: true,
      } as any);
      expect(error).toBeNull();
    }

    // Now attempt P1→P2 : descendant walk from P2 hits depth 6 → trigger raises.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
    const { error: depthErr } = await admin.from('recipes').insert({
      product_id: ids[0], material_id: ids[1], quantity: 1, unit: 'pcs', is_active: true,
    } as any);
    expect(depthErr).not.toBeNull();
    expect(depthErr?.message ?? '').toMatch(/recipe_depth_exceeded|recipe_cycle_detected/);
    expect(depthErr?.code ?? '').toBe('P0001');
  });
});
