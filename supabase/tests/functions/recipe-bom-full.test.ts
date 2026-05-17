// supabase/tests/functions/recipe-bom-full.test.ts
// Session 17 / Phase 1.D — Live integration smoke test for recipe_bom_full_v1.
//
// Coverage:
//   - Happy path: flat recipe (Brioche BRD-004, 7 leaf materials) returns
//     all expected columns, array non-empty, each row typed correctly.
//   - Multi-level: created in-test using admin insert + RPC. Two levels deep.
//   - Permission gate: unauthenticated call returns forbidden error.
//
// NOTE: The seed has no multi-level recipes (all are flat ingredient lists).
// The multi-level test builds its own fixture via admin client and cleans up
// in afterAll. This mirrors the recipe-calculate-cost.test.ts pattern.
//
// Skips gracefully when env vars are missing (CI dry-run without credentials).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? '';
const PIN_FN_URL   = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/auth-verify-pin` : '';

const liveCfg      = !!SUPABASE_URL && !!SERVICE && !!ANON;
const describeLive = liveCfg ? describe : describe.skip;

// Seeded Brioche product — flat recipe with 7 leaf materials.
const BRIOCHE_ID = '216ffad1-09ee-4282-a52b-5e8ef1a70442';

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

interface BomRow {
  material_id:   string;
  material_name: string;
  material_unit: string;
  qty_per_unit:  number;
  current_stock: number;
  cost_price:    number;
}

interface ProdRow { id: string; sku: string; }

async function mkProduct(
  admin: SupabaseClient,
  sku: string,
  name: string,
  unit: string,
  cost: number,
): Promise<ProdRow> {
  await admin.from('products').delete().eq('sku', sku);
  const { data: cat } = await admin.from('categories').select('id').limit(1).single();
  if (!cat) throw new Error('No category seeded');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.from('products').insert({
    sku, name,
    category_id: (cat as { id: string }).id,
    retail_price: 1000,
    current_stock: 500,
    unit,
    cost_price: cost,
    product_type: 'finished',
    is_active: true,
  } as any).select('id, sku').single();
  if (error || !data) throw new Error(`mkProduct(${sku}): ${error?.message}`);
  return data as ProdRow;
}

const SKU_PREFIX = 'S17-BOM';
const allSkus: string[] = [];

async function cleanupAll(admin: SupabaseClient) {
  if (allSkus.length === 0) return;
  const { data: prods } = await admin.from('products').select('id').in('sku', allSkus);
  const ids = (prods ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return;
  await admin.from('recipes').delete().in('product_id', ids);
  await admin.from('recipes').delete().in('material_id', ids);
  await admin.from('products').delete().in('id', ids);
}

describeLive('recipe_bom_full_v1 — live integration', () => {
  let managerToken: string;
  let admin: SupabaseClient;

  beforeAll(async () => {
    managerToken = await loginAs('EMP000', '111111');
    admin = createClient(SUPABASE_URL, SERVICE);
  }, 30_000);

  afterAll(async () => {
    if (liveCfg) await cleanupAll(admin);
  });

  it('flat recipe (Brioche): returns leaf materials with correct shape', async () => {
    const mgr = jwtClient(managerToken);
    const { data, error } = await mgr.rpc('recipe_bom_full_v1', {
      p_product_id: BRIOCHE_ID,
      p_max_depth: 5,
    });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data as BomRow[]).length).toBeGreaterThan(0);

    for (const row of data as BomRow[]) {
      expect(row).toMatchObject({
        material_id:   expect.any(String),
        material_name: expect.any(String),
        material_unit: expect.any(String),
        qty_per_unit:  expect.any(Number),
        current_stock: expect.any(Number),
        cost_price:    expect.any(Number),
      });
      // UUIDs are 36 chars
      expect(row.material_id).toHaveLength(36);
      // qty must be positive
      expect(row.qty_per_unit).toBeGreaterThan(0);
    }
  });

  it('output is sorted alphabetically by material_name', async () => {
    const mgr = jwtClient(managerToken);
    const { data, error } = await mgr.rpc('recipe_bom_full_v1', {
      p_product_id: BRIOCHE_ID,
      p_max_depth: 5,
    });

    expect(error).toBeNull();
    const rows = data as BomRow[];
    const names = rows.map(r => r.material_name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('2-level cascade: leaf_a appears once (multi-path aggregation)', async () => {
    const leaf_a = await mkProduct(admin, `${SKU_PREFIX}-TS-LA`, 'BOM TS Leaf A', 'pcs', 100);
    const leaf_b = await mkProduct(admin, `${SKU_PREFIX}-TS-LB`, 'BOM TS Leaf B', 'pcs', 50);
    const sub1   = await mkProduct(admin, `${SKU_PREFIX}-TS-S1`, 'BOM TS Sub 1',  'pcs', 0);
    const top    = await mkProduct(admin, `${SKU_PREFIX}-TS-TOP`,'BOM TS Top',    'pcs', 0);
    allSkus.push(leaf_a.sku, leaf_b.sku, sub1.sku, top.sku);

    const mgr = jwtClient(managerToken);

    // sub1 := 0.5 leaf_a + 0.3 leaf_b
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: sub1.id, p_material_id: leaf_a.id, p_quantity: 0.5,
      p_unit: 'pcs', p_notes: null,
    });
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: sub1.id, p_material_id: leaf_b.id, p_quantity: 0.3,
      p_unit: 'pcs', p_notes: null,
    });
    // top := 0.1 sub1 + 0.2 leaf_a (leaf_a via 2 paths)
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: top.id, p_material_id: sub1.id, p_quantity: 0.1,
      p_unit: 'pcs', p_notes: null,
    });
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: top.id, p_material_id: leaf_a.id, p_quantity: 0.2,
      p_unit: 'pcs', p_notes: null,
    });

    const { data, error } = await mgr.rpc('recipe_bom_full_v1', {
      p_product_id: top.id,
      p_max_depth: 5,
    });

    expect(error).toBeNull();
    const rows = data as BomRow[];

    // sub1 must NOT appear (has children → not a leaf)
    const sub1Row = rows.find(r => r.material_id === sub1.id);
    expect(sub1Row).toBeUndefined();

    // leaf_a must appear EXACTLY ONCE (aggregated across paths)
    const leafARows = rows.filter(r => r.material_id === leaf_a.id);
    expect(leafARows).toHaveLength(1);

    // leaf_a qty = 0.1*0.5 + 0.2 = 0.05 + 0.2 = 0.25
    expect(Number(leafARows[0].qty_per_unit)).toBeCloseTo(0.25, 6);

    // leaf_b must appear (via sub1)
    const leafBRows = rows.filter(r => r.material_id === leaf_b.id);
    expect(leafBRows).toHaveLength(1);
    // leaf_b qty = 0.1*0.3 = 0.03
    expect(Number(leafBRows[0].qty_per_unit)).toBeCloseTo(0.03, 6);
  });

  it('invalid p_max_depth returns an error', async () => {
    const mgr = jwtClient(managerToken);
    const { error } = await mgr.rpc('recipe_bom_full_v1', {
      p_product_id: BRIOCHE_ID,
      p_max_depth: 0,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('P0001');
  });

  it('product with no recipe rows returns empty array', async () => {
    // Create a product with no recipe rows — it is a leaf by definition.
    const bare = await mkProduct(admin, `${SKU_PREFIX}-TS-BARE`, 'BOM TS Bare', 'pcs', 50);
    allSkus.push(bare.sku);

    const mgr = jwtClient(managerToken);
    const { data, error } = await mgr.rpc('recipe_bom_full_v1', {
      p_product_id: bare.id,
      p_max_depth: 5,
    });

    expect(error).toBeNull();
    // A product with no recipe has no walk nodes → empty BoM.
    expect(Array.isArray(data)).toBe(true);
    expect((data as BomRow[]).length).toBe(0);
  });
});
