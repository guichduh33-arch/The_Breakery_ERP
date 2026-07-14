// supabase/tests/functions/search-ingredients-polish.test.ts
// Session 16 / Phase 2.A — live RPC smoke for search_ingredients_v1 polish.
//
// Coverage :
//   - is_semi_finished flag drives kind='semi_finished' classification.
//   - pg_trgm similarity() matches misspelled queries (e.g. "croisant" ->
//     "PolishedLeafCroisant").
//   - Exact name match still wins rank 0 (similarity tier is rank 2/3).
//
// Skips gracefully when env vars are missing. Mirrors the per-file pattern
// used by recipe-versions-snapshot.test.ts and recipe-calculate-cost.test.ts
// (no shared sandbox helpers exist in this repo as of Session 16).

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
  await admin.from('products').delete().eq('sku', sku);
  const { data: cat } = await admin.from('categories').select('id').limit(1).single();
  if (!cat) throw new Error('No category seeded');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag the new is_semi_finished column
  const { data, error } = await admin.from('products').insert({
    sku, name,
    category_id: (cat as { id: string }).id,
    retail_price: 1000, current_stock: 0, unit,
    cost_price: cost, product_type: 'finished', is_active: true,
  } as any).select('id, sku').single();
  if (error || !data) throw new Error(`mkProduct(${sku}) failed: ${error?.message}`);
  return data as ProdRow;
}

const SKU_PREFIX = 'S16-PICK';
const allSkus: string[] = [];

async function cleanupAll(admin: SupabaseClient) {
  if (allSkus.length === 0) return;
  const { data: prods } = await admin.from('products')
    .select('id').in('sku', allSkus);
  const ids = (prods ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return;
  await admin.from('recipes').delete().in('product_id', ids);
  await admin.from('recipes').delete().in('material_id', ids);
  await admin.from('products').delete().in('id', ids);
}

interface SearchRow {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  cost_price: number;
  current_stock: number;
  kind: 'raw' | 'sub_recipe' | 'semi_finished';
  has_recipe: boolean;
}

describeLive('search_ingredients_v1 polish', () => {
  let managerToken: string;
  let admin: SupabaseClient;
  let semiId: string;
  let leafId: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP000', '111111'); // admin has inventory.read
    admin = createClient(SUPABASE_URL, SERVICE);

    const leaf = await mkProduct(admin, `${SKU_PREFIX}-LEAF`, 'PolishedLeafCroisant', 'g',  0.01);
    const sub  = await mkProduct(admin, `${SKU_PREFIX}-SUB`,  'PolishedSubDough',     'kg', 0);
    const semi = await mkProduct(admin, `${SKU_PREFIX}-SEMI`, 'PolishedSemiPainChoc', 'pcs', 0);
    allSkus.push(leaf.sku, sub.sku, semi.sku);
    leafId = leaf.id;
    semiId = semi.id;

    const mgr = jwtClient(managerToken);
    // sub recipe : SUB := 500 g of LEAF.
    const { error: e1 } = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: sub.id, p_material_id: leaf.id, p_quantity: 500, p_unit: 'g', p_notes: null,
    });
    if (e1) throw new Error(`upsert_recipe_v1 (sub) failed: ${e1.message}`);
    // semi recipe : SEMI := 0.05 kg of SUB. This makes SEMI semi-finished (nesting >= 2).
    const { error: e2 } = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: semi.id, p_material_id: sub.id, p_quantity: 0.05, p_unit: 'kg', p_notes: null,
    });
    if (e2) throw new Error(`upsert_recipe_v1 (semi) failed: ${e2.message}`);
  }, 30_000);

  afterAll(async () => {
    if (liveCfg) await cleanupAll(admin);
  });

  it('returns is_semi_finished via the maintained flag', async () => {
    const mgr = jwtClient(managerToken);
    const { data, error } = await mgr.rpc('search_ingredients_v1', {
      p_query: 'PolishedSemiPainChoc',
      p_kind:  'semi_finished',
      p_limit: 5,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as SearchRow[];
    expect(rows.some((r) => r.product_id === semiId && r.kind === 'semi_finished')).toBe(true);
  });

  it('matches misspelled query via pg_trgm similarity', async () => {
    const mgr = jwtClient(managerToken);
    const { data, error } = await mgr.rpc('search_ingredients_v1', {
      p_query: 'croisant',
      p_kind:  'all',
      p_limit: 10,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as SearchRow[];
    expect(rows.some((r) => r.product_id === leafId)).toBe(true);
  });

  it('ranks exact match first even when trigram score for another row is high', async () => {
    const mgr = jwtClient(managerToken);
    const { data, error } = await mgr.rpc('search_ingredients_v1', {
      p_query: 'PolishedLeafCroisant',
      p_kind:  'all',
      p_limit: 5,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as SearchRow[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.product_id).toBe(leafId);
  });
});
