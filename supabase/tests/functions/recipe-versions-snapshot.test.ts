// supabase/tests/functions/recipe-versions-snapshot.test.ts
// Session 15 / Phase 1.C — Live integration tests for the
// `tr_recipes_snapshot_version` trigger and the `recipe_versions` table.
//
// Coverage :
//   - upsert_recipe_v1 (insert) → 1 recipe_versions row (version_number=1).
//   - upsert_recipe_v1 (update) → version_number=2 (per-row firing).
//   - deactivate_recipe_v1 (soft-delete via UPDATE) → version_number=3.
//   - 5 sequential upserts on distinct materials → version_number=5
//     (per-row firing semantic confirmed — caveat from recipe-db-arch).
//
// Skips gracefully when env vars missing. Cleanup in afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? '';
const PIN_FN_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/auth-verify-pin` : '';

const liveCfg = !!SUPABASE_URL && !!SERVICE && !!ANON;
const describeLive = liveCfg ? describe : describe.skip;

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

interface ProdRow { id: string; sku: string; }

const SKU_PREFIX = 'S15-VER';
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

async function maxVersion(admin: SupabaseClient, productId: string): Promise<number | null> {
  const { data } = await admin.from('recipe_versions')
    .select('version_number')
    .eq('product_id', productId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (data as { version_number: number }).version_number : null;
}

describeLive('recipe_versions snapshot trigger — live integration', () => {
  let managerToken: string;
  let admin: SupabaseClient;

  beforeAll(async () => {
    managerToken = await loginAs('EMP000', '111111');
    admin = createClient(SUPABASE_URL, SERVICE);
  }, 30_000);

  afterAll(async () => {
    if (liveCfg) await cleanupAll(admin);
  });

  it('INSERT recipe row creates recipe_versions row with version_number=1', async () => {
    const p = await mkProduct(admin, `${SKU_PREFIX}-INS-P`);
    const m = await mkProduct(admin, `${SKU_PREFIX}-INS-M`);
    allSkus.push(p.sku, m.sku);

    const mgr = jwtClient(managerToken);
    const r = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: p.id, p_material_id: m.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    expect(r.error).toBeNull();

    const { data: versions, error: ve } = await admin.from('recipe_versions')
      .select('version_number, snapshot')
      .eq('product_id', p.id)
      .order('version_number');
    expect(ve).toBeNull();
    expect(versions).toHaveLength(1);
    expect((versions as { version_number: number }[])[0].version_number).toBe(1);
    const snap = (versions as { snapshot: unknown[] }[])[0].snapshot;
    expect(Array.isArray(snap)).toBe(true);
    expect(snap.length).toBe(1);
  });

  it('UPDATE recipe row bumps version_number to 2', async () => {
    const p = await mkProduct(admin, `${SKU_PREFIX}-UPD-P`);
    const m = await mkProduct(admin, `${SKU_PREFIX}-UPD-M`);
    allSkus.push(p.sku, m.sku);

    const mgr = jwtClient(managerToken);
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: p.id, p_material_id: m.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();

    // Upsert again with new qty — UPDATE path inside the RPC.
    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: p.id, p_material_id: m.id, p_quantity: 2, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();

    expect(await maxVersion(admin, p.id)).toBe(2);
  });

  it('deactivate_recipe_v1 (soft-delete) bumps version_number to 3', async () => {
    const p = await mkProduct(admin, `${SKU_PREFIX}-DEL-P`);
    const m = await mkProduct(admin, `${SKU_PREFIX}-DEL-M`);
    allSkus.push(p.sku, m.sku);

    const mgr = jwtClient(managerToken);
    const r1 = await mgr.rpc('upsert_recipe_v1', {
      p_product_id: p.id, p_material_id: m.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
    });
    expect(r1.error).toBeNull();
    const recipeId = r1.data as string;

    expect((await mgr.rpc('upsert_recipe_v1', {
      p_product_id: p.id, p_material_id: m.id, p_quantity: 3, p_unit: 'pcs', p_notes: null,
    })).error).toBeNull();

    expect((await mgr.rpc('deactivate_recipe_v1', { p_recipe_id: recipeId })).error).toBeNull();

    expect(await maxVersion(admin, p.id)).toBe(3);
  });

  it('5 sequential upserts on distinct materials → version_number=5 (per-row firing)', async () => {
    const p = await mkProduct(admin, `${SKU_PREFIX}-BULK-P`);
    const m1 = await mkProduct(admin, `${SKU_PREFIX}-BULK-M1`);
    const m2 = await mkProduct(admin, `${SKU_PREFIX}-BULK-M2`);
    const m3 = await mkProduct(admin, `${SKU_PREFIX}-BULK-M3`);
    const m4 = await mkProduct(admin, `${SKU_PREFIX}-BULK-M4`);
    const m5 = await mkProduct(admin, `${SKU_PREFIX}-BULK-M5`);
    allSkus.push(p.sku, m1.sku, m2.sku, m3.sku, m4.sku, m5.sku);

    const mgr = jwtClient(managerToken);
    for (const m of [m1, m2, m3, m4, m5]) {
      const r = await mgr.rpc('upsert_recipe_v1', {
        p_product_id: p.id, p_material_id: m.id, p_quantity: 1, p_unit: 'pcs', p_notes: null,
      });
      expect(r.error).toBeNull();
    }

    expect(await maxVersion(admin, p.id)).toBe(5);
  });
});
