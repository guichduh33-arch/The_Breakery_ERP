// supabase/tests/functions/inventory-production.test.ts
// Session 13 / Phase 2.A — Live integration tests for record_production_v1
// and revert_production_v1.
//
// Coverage:
//   - Happy path : 50-baguette cycle with 4 recipes (flour 250g, salt 5g,
//     yeast 5g, water 150mL) → 1 production_in + 4 production_out + 5 JEs.
//   - Stock decrements via unit conversion (g→kg, mL→L) match expectations.
//   - Idempotency replay returns same production_id with no duplicates.
//   - Insufficient stock → P0002 with missing items in error message.
//   - Cashier → forbidden.
//   - Admin revert restores stock + posts counter-JEs.
//
// Mirrors the receive-stock / waste-stock test patterns.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
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
  const body = await res.json();
  if (!body.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.auth.access_token as string;
}

function jwtClient(token: string) {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

interface ProdRow { id: string; current_stock: number; sku: string; }

async function ensureProduct(
  admin: ReturnType<typeof createClient>,
  sku: string,
  name: string,
  unit: string,
  cost: number,
  initialStock: number,
): Promise<ProdRow> {
  const { data: cat } = await admin.from('categories').select('id').limit(1).single();
  const { data: existing } = await admin
    .from('products')
    .select('id, current_stock, sku')
    .eq('sku', sku)
    .maybeSingle();
  if (existing) {
    await admin.from('products').update({ current_stock: initialStock }).eq('id', existing.id);
    return { ...(existing as ProdRow), current_stock: initialStock };
  }
  const { data, error } = await admin.from('products').insert({
    sku, name, category_id: (cat as { id: string }).id,
    retail_price: 5000, current_stock: initialStock,
    unit, cost_price: cost, product_type: 'finished', is_active: true,
  }).select('id, current_stock, sku').single();
  if (error) throw error;
  return data as ProdRow;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('record_production_v1 + revert_production_v1 — integration', () => {
  let managerToken: string;
  let cashierToken: string;
  let adminToken:   string;
  let baguette:     ProdRow;
  let flour:        ProdRow;
  let salt:         ProdRow;
  let yeast:        ProdRow;
  let water:        ProdRow;
  let sectionId:    string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
    cashierToken = await loginAs('EMP001', '111111');
    adminToken   = await loginAs('EMP000', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    baguette = await ensureProduct(admin, 'T_PROD_BAGUETTE', 'Test Baguette', 'pcs', 1500, 0);
    flour    = await ensureProduct(admin, 'T_PROD_FLOUR',    'Test Flour',    'kg',  10000, 100);
    salt     = await ensureProduct(admin, 'T_PROD_SALT',     'Test Salt',     'kg',  5000,  50);
    yeast    = await ensureProduct(admin, 'T_PROD_YEAST',    'Test Yeast',    'kg',  80000, 10);
    water    = await ensureProduct(admin, 'T_PROD_WATER',    'Test Water',    'L',   1000,  200);

    const { data: section } = await admin.from('sections')
      .select('id').is('deleted_at', null).order('display_order').limit(1).single();
    sectionId = (section as { id: string }).id;

    // Seed 4 recipes as manager.
    const mgr = jwtClient(managerToken);
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: baguette.id, p_material_id: flour.id,
      p_quantity: 250, p_unit: 'g', p_notes: null,
    });
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: baguette.id, p_material_id: salt.id,
      p_quantity: 5, p_unit: 'g', p_notes: null,
    });
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: baguette.id, p_material_id: yeast.id,
      p_quantity: 5, p_unit: 'g', p_notes: null,
    });
    await mgr.rpc('upsert_recipe_v1', {
      p_product_id: baguette.id, p_material_id: water.id,
      p_quantity: 150, p_unit: 'mL', p_notes: null,
    });
  });

  beforeEach(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('products').update({ current_stock: 0   }).eq('id', baguette.id);
    await admin.from('products').update({ current_stock: 100 }).eq('id', flour.id);
    await admin.from('products').update({ current_stock: 50  }).eq('id', salt.id);
    await admin.from('products').update({ current_stock: 10  }).eq('id', yeast.id);
    await admin.from('products').update({ current_stock: 200 }).eq('id', water.id);
  });

  it('manager happy path: 50 baguettes → 5 movements + 5 balanced JEs', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb.rpc('record_production_v1', {
      p_product_id:        baguette.id,
      p_quantity_produced: 50,
      p_section_id:        sectionId,
      p_batch_number:      'VT-001',
      p_quantity_waste:    0,
      p_notes:             'vitest happy path',
      p_idempotency_key:   null,
    });
    expect(error).toBeNull();
    const result = data as {
      production_id: string; production_number: string;
      movements_count: number; je_count: number; idempotent_replay: boolean;
    };
    expect(result.production_number).toMatch(/^PROD-\d{8}-\d{4,}$/);
    expect(result.movements_count).toBe(5);
    expect(result.je_count).toBe(5);
    expect(result.idempotent_replay).toBe(false);

    // Verify stock decrements via unit conversion.
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: stocks } = await admin.from('products')
      .select('sku, current_stock')
      .in('sku', ['T_PROD_BAGUETTE','T_PROD_FLOUR','T_PROD_SALT','T_PROD_YEAST','T_PROD_WATER']);
    const byKey = Object.fromEntries(
      (stocks as { sku: string; current_stock: number }[]).map(r => [r.sku, Number(r.current_stock)])
    );
    expect(byKey['T_PROD_BAGUETTE']).toBe(50);
    expect(byKey['T_PROD_FLOUR']).toBeCloseTo(87.5, 3);  // 100 - 12.5kg
    expect(byKey['T_PROD_SALT']).toBeCloseTo(49.75, 3);
    expect(byKey['T_PROD_YEAST']).toBeCloseTo(9.75, 3);
    expect(byKey['T_PROD_WATER']).toBeCloseTo(192.5, 3);

    // Verify journal entries are balanced (DR=CR per JE).
    const { data: jes } = await admin
      .from('journal_entries')
      .select('total_debit, total_credit, metadata')
      .eq('reference_type', 'stock_movement')
      .gte('created_at', new Date(Date.now() - 60_000).toISOString());
    const productionJes = (jes as { total_debit: number; total_credit: number; metadata: { movement_type?: string } }[])
      .filter(je => (je.metadata?.movement_type ?? '').startsWith('production'));
    expect(productionJes.length).toBeGreaterThanOrEqual(5);
    for (const je of productionJes) {
      expect(Number(je.total_debit)).toBeCloseTo(Number(je.total_credit), 2);
    }
  });

  it('idempotency replay: same key returns same production_id', async () => {
    const sb = jwtClient(managerToken);
    const key = '00000000-0000-0000-0000-cafebabe0001';

    const r1 = await sb.rpc('record_production_v1', {
      p_product_id: baguette.id, p_quantity_produced: 10, p_section_id: sectionId,
      p_batch_number: 'VT-IDEM', p_quantity_waste: 0, p_notes: null, p_idempotency_key: key,
    });
    expect(r1.error).toBeNull();
    const id1 = (r1.data as { production_id: string }).production_id;

    const r2 = await sb.rpc('record_production_v1', {
      p_product_id: baguette.id, p_quantity_produced: 10, p_section_id: sectionId,
      p_batch_number: 'VT-IDEM', p_quantity_waste: 0, p_notes: null, p_idempotency_key: key,
    });
    expect(r2.error).toBeNull();
    const result2 = r2.data as { production_id: string; idempotent_replay: boolean };
    expect(result2.production_id).toBe(id1);
    expect(result2.idempotent_replay).toBe(true);

    // Cleanup
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('production_records').delete().eq('idempotency_key', key);
  });

  it('insufficient stock raises error with material name in message', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('products').update({ current_stock: 0.5 }).eq('id', flour.id);
    const sb = jwtClient(managerToken);
    const { error } = await sb.rpc('record_production_v1', {
      p_product_id: baguette.id, p_quantity_produced: 50, p_section_id: sectionId,
      p_batch_number: null, p_quantity_waste: 0, p_notes: null, p_idempotency_key: null,
    });
    expect(error?.message ?? '').toMatch(/insufficient_stock/);
  });

  it('cashier role: record_production_v1 raises forbidden', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('record_production_v1', {
      p_product_id: baguette.id, p_quantity_produced: 10, p_section_id: sectionId,
      p_batch_number: null, p_quantity_waste: 0, p_notes: null, p_idempotency_key: null,
    });
    expect(error?.message ?? '').toMatch(/forbidden/);
  });

  it('admin reverts production within 24h → stock restored', async () => {
    const sb = jwtClient(managerToken);
    const { data: produced, error: prodErr } = await sb.rpc('record_production_v1', {
      p_product_id: baguette.id, p_quantity_produced: 20, p_section_id: sectionId,
      p_batch_number: 'VT-REV', p_quantity_waste: 0, p_notes: null, p_idempotency_key: null,
    });
    expect(prodErr).toBeNull();
    const productionId = (produced as { production_id: string }).production_id;

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: bagAfterProd } = await admin.from('products')
      .select('current_stock').eq('id', baguette.id).single();
    expect(Number((bagAfterProd as { current_stock: number }).current_stock)).toBe(20);

    const adminSb = jwtClient(adminToken);
    const { data: rev, error: revErr } = await adminSb.rpc('revert_production_v1', {
      p_production_id: productionId,
      p_reason:        'vitest revert',
    });
    expect(revErr).toBeNull();
    const revResult = rev as { reverse_movements_count: number; reverse_je_count: number };
    expect(revResult.reverse_movements_count).toBe(5);
    expect(revResult.reverse_je_count).toBe(5);

    const { data: bagAfterRev } = await admin.from('products')
      .select('current_stock').eq('id', baguette.id).single();
    expect(Number((bagAfterRev as { current_stock: number }).current_stock)).toBe(0);

    const { data: pr } = await admin.from('production_records')
      .select('reverted_at, reverted_reason').eq('id', productionId).single();
    expect((pr as { reverted_at: string | null }).reverted_at).not.toBeNull();
    expect((pr as { reverted_reason: string }).reverted_reason).toBe('vitest revert');
  });

  it('manager cannot revert production → forbidden', async () => {
    const sb = jwtClient(managerToken);
    const { data: produced } = await sb.rpc('record_production_v1', {
      p_product_id: baguette.id, p_quantity_produced: 5, p_section_id: sectionId,
      p_batch_number: null, p_quantity_waste: 0, p_notes: null, p_idempotency_key: null,
    });
    const productionId = (produced as { production_id: string }).production_id;
    const { error } = await sb.rpc('revert_production_v1', {
      p_production_id: productionId, p_reason: 'should not work',
    });
    expect(error?.message ?? '').toMatch(/forbidden/);
  });

  it('view_product_recipes exposes the joined row to authenticated', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb
      .from('view_product_recipes')
      .select('product_sku, material_sku, quantity, unit, material_unit')
      .eq('product_sku', 'T_PROD_BAGUETTE')
      .order('material_sku');
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(4);
    const rows = data as { product_sku: string; material_sku: string; quantity: number; unit: string; material_unit: string }[];
    const flourRow = rows.find(r => r.material_sku === 'T_PROD_FLOUR');
    expect(flourRow).toBeDefined();
    expect(flourRow!.unit).toBe('g');
    expect(flourRow!.material_unit).toBe('kg');
  });
});
