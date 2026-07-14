// supabase/tests/functions/record-production-cascade.test.ts
// Session 15 / Phase 1.C — Live integration tests for
// record_production_v1's sub-recipe cascade (p_recurse_subrecipes=TRUE).
//
// Coverage :
//   - 2-level cascade (FIN := INT + leaves) with recurse=TRUE :
//       movements_count = 1 production_in + N distinct leaves.
//       materials_breakdown has both leaf=true and is_intermediate=true rows.
//       recipe_version_id is populated.
//   - Idempotency replay returns same production_id, idempotent_replay=true.
//   - recurse=FALSE consumes only the direct material (flat behaviour).
//
// NOTE on stock_movements lookup : record_stock_movement_v1 hardcodes
// `reference_type='admin_action'` and never sets `reference_id`. The
// production_id is captured in stock_movements.metadata->>'production_id'.
// See deviation pack D-S13-MVTREF-01.
//
// Skips gracefully when env missing. Cleanup in afterAll.

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

const SKU_PREFIX = 'S15-CASC';
const allSkus: string[] = [];

async function mkProduct(
  admin: SupabaseClient,
  sku: string,
  cost: number,
  stock: number,
): Promise<ProdRow> {
  await admin.from('products').delete().eq('sku', sku);
  const { data: cat } = await admin.from('categories').select('id').limit(1).single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
  const { data, error } = await admin.from('products').insert({
    sku, name: sku,
    category_id: (cat as { id: string }).id,
    retail_price: 1000, current_stock: stock, unit: 'pcs',
    cost_price: cost, product_type: 'finished', is_active: true,
  } as any).select('id, sku').single();
  if (error || !data) throw new Error(`mkProduct(${sku}): ${error?.message}`);
  return data as ProdRow;
}

async function cleanupAll(admin: SupabaseClient) {
  if (allSkus.length === 0) return;
  const { data: prods } = await admin.from('products').select('id').in('sku', allSkus);
  const ids = (prods ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return;
  // Production records reference these products. Delete dependent rows first.
  const { data: prs } = await admin.from('production_records').select('id').in('product_id', ids);
  const prIds = (prs ?? []).map((r: { id: string }) => r.id);
  if (prIds.length > 0) {
    // stock_movements ledger is append-only; we leave the rows. They'll be
    // garbage by tag (metadata.production_id) but not deleted — by design.
    await admin.from('production_records').delete().in('id', prIds);
  }
  await admin.from('recipes').delete().in('product_id', ids);
  await admin.from('recipes').delete().in('material_id', ids);
  await admin.from('products').delete().in('id', ids);
}

describeLive('record_production_v1 sub-recipe cascade — live integration', () => {
  let managerToken: string;
  let admin: SupabaseClient;
  let sectionId: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP000', '111111');
    admin = createClient(SUPABASE_URL, SERVICE);
    const { data: section } = await admin.from('sections')
      .select('id').is('deleted_at', null).order('display_order').limit(1).single();
    if (!section) throw new Error('No section seeded');
    sectionId = (section as { id: string }).id;
  }, 30_000);

  afterAll(async () => {
    if (liveCfg) await cleanupAll(admin);
  });

  it('2-level cascade with recurse=TRUE: 1 production_in + N leaves, breakdown flags set, version_id populated', async () => {
    const fin = await mkProduct(admin, `${SKU_PREFIX}-MAIN-FIN`, 0, 0);
    const int = await mkProduct(admin, `${SKU_PREFIX}-MAIN-INT`, 0, 0);
    const la  = await mkProduct(admin, `${SKU_PREFIX}-MAIN-LA`,  100, 1000);
    const lb  = await mkProduct(admin, `${SKU_PREFIX}-MAIN-LB`,  150, 1000);
    allSkus.push(fin.sku, int.sku, la.sku, lb.sku);

    const mgr = jwtClient(managerToken);
    // INT := 1 LA + 1 LB
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: int.id, p_material_id: la.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: int.id, p_material_id: lb.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();
    // FIN := 1 INT
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: fin.id, p_material_id: int.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();

    const { data, error } = await mgr.rpc('record_production_v1', {
      p_product_id: fin.id,
      p_quantity_produced: 5,
      p_section_id: sectionId,
      p_batch_number: 'CASC-MAIN',
      p_quantity_waste: 0,
      p_notes: 'vitest cascade',
      p_idempotency_key: null,
      p_recurse_subrecipes: true,
    });
    expect(error).toBeNull();
    const result = data as {
      production_id: string;
      production_number: string;
      movements_count: number;
      idempotent_replay: boolean;
      recipe_version_id: string | null;
      depth_reached: number;
      materials_breakdown: Array<{ leaf: boolean; is_intermediate: boolean; material_id: string }>;
    };

    expect(result.idempotent_replay).toBe(false);
    expect(result.movements_count).toBe(3); // 1 in + 2 leaves
    expect(result.recipe_version_id).toBeTruthy();
    expect(result.depth_reached).toBeGreaterThanOrEqual(2);

    const hasIntermediate = result.materials_breakdown.some(l => l.is_intermediate === true);
    const hasLeaf = result.materials_breakdown.some(l => l.leaf === true);
    expect(hasIntermediate).toBe(true);
    expect(hasLeaf).toBe(true);

    // Verify stock_movements via metadata.production_id (see D-S13-MVTREF-01).
    const { data: movs } = await admin.from('stock_movements')
      .select('movement_type, product_id, quantity')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter('metadata->>production_id', 'eq', result.production_id) as any;
    const rows = (movs ?? []) as { movement_type: string; product_id: string; quantity: string }[];
    const ins = rows.filter(r => r.movement_type === 'production_in');
    const outs = rows.filter(r => r.movement_type === 'production_out');
    expect(ins.length).toBe(1);
    expect(outs.length).toBe(2);
    const outMaterials = new Set(outs.map(r => r.product_id));
    // Only leaves should be in out movements.
    expect(outMaterials.has(la.id)).toBe(true);
    expect(outMaterials.has(lb.id)).toBe(true);
    expect(outMaterials.has(int.id)).toBe(false);
  });

  it('idempotency replay: same key returns same production_id, no extra movements', async () => {
    const fin = await mkProduct(admin, `${SKU_PREFIX}-IDEM-FIN`, 0, 0);
    const m   = await mkProduct(admin, `${SKU_PREFIX}-IDEM-M`,   100, 1000);
    allSkus.push(fin.sku, m.sku);

    const mgr = jwtClient(managerToken);
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: fin.id, p_material_id: m.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();

    const key = crypto.randomUUID();
    const r1 = await mgr.rpc('record_production_v1', {
      p_product_id: fin.id, p_quantity_produced: 2, p_section_id: sectionId,
      p_batch_number: 'IDEM', p_quantity_waste: 0, p_notes: null,
      p_idempotency_key: key, p_recurse_subrecipes: true,
    });
    expect(r1.error).toBeNull();
    const r1d = r1.data as { production_id: string; idempotent_replay: boolean };
    expect(r1d.idempotent_replay).toBe(false);

    const r2 = await mgr.rpc('record_production_v1', {
      p_product_id: fin.id, p_quantity_produced: 2, p_section_id: sectionId,
      p_batch_number: 'IDEM', p_quantity_waste: 0, p_notes: null,
      p_idempotency_key: key, p_recurse_subrecipes: true,
    });
    expect(r2.error).toBeNull();
    const r2d = r2.data as { production_id: string; idempotent_replay: boolean };
    expect(r2d.production_id).toBe(r1d.production_id);
    expect(r2d.idempotent_replay).toBe(true);

    // No extra movements created on replay.
    const { data: movs } = await admin.from('stock_movements')
      .select('id')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter('metadata->>production_id', 'eq', r1d.production_id) as any;
    expect((movs ?? []).length).toBe(2); // 1 in + 1 out, no duplication
  });

  it('recurse=FALSE on a 2-level recipe consumes only the direct intermediate (flat BoM)', async () => {
    const fin = await mkProduct(admin, `${SKU_PREFIX}-FLAT-FIN`, 0, 0);
    const int = await mkProduct(admin, `${SKU_PREFIX}-FLAT-INT`, 100, 1000);
    const leaf= await mkProduct(admin, `${SKU_PREFIX}-FLAT-LEAF`, 50, 1000);
    allSkus.push(fin.sku, int.sku, leaf.sku);

    const mgr = jwtClient(managerToken);
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: int.id, p_material_id: leaf.id, p_quantity: 2, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: fin.id, p_material_id: int.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();

    const { data, error } = await mgr.rpc('record_production_v1', {
      p_product_id: fin.id, p_quantity_produced: 3, p_section_id: sectionId,
      p_batch_number: 'FLAT', p_quantity_waste: 0, p_notes: null,
      p_idempotency_key: null, p_recurse_subrecipes: false,
    });
    expect(error).toBeNull();
    const result = data as { production_id: string; movements_count: number; depth_reached: number };
    // 1 production_in (FIN) + 1 production_out (INT, treated as flat material).
    expect(result.movements_count).toBe(2);
    expect(result.depth_reached).toBe(1);

    const { data: movs } = await admin.from('stock_movements')
      .select('movement_type, product_id')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter('metadata->>production_id', 'eq', result.production_id) as any;
    const outs = (movs ?? []).filter((r: { movement_type: string }) => r.movement_type === 'production_out');
    expect(outs.length).toBe(1);
    expect((outs[0] as { product_id: string }).product_id).toBe(int.id);
  });
});
