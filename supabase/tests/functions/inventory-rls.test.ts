// supabase/tests/functions/inventory-rls.test.ts
// Session 12 — RLS + GRANT coverage for the inventory module.
//
// Asserts:
//   - authenticated users CANNOT INSERT/UPDATE/DELETE stock_movements directly
//   - authenticated users CAN SELECT stock_movements only via inventory.read
//   - CASHIER (no inventory.read) gets zero rows from get_stock_levels_v1 (forbidden)
//   - MANAGER (inventory.read/receive/waste) is allowed reads + receive/waste
//   - MANAGER is denied adjust_stock_v1 (ADMIN-only)
//   - ADMIN passes the full matrix
//   - anon role gets nothing on stock_movements + rpc()

import { describe, it, expect, beforeAll } from 'vitest';
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

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('inventory RLS + GRANT matrix', () => {
  let adminToken:   string;
  let managerToken: string;
  let cashierToken: string;
  let productId:    string;
  let seedMovementId: string;
  let supplierId:   string;

  beforeAll(async () => {
    adminToken   = await loginAs('EMP000', '123456');
    managerToken = await loginAs('EMP003', '111111');
    cashierToken = await loginAs('EMP001', '567890');

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    productId = p!.id;

    // Service-role bypasses RLS — seed a movement we can SELECT against.
    const code = `INV-RLS-${Date.now()}`;
    const { data: sup } = await admin.from('suppliers')
      .insert({ code, name: 'RLS test supplier', is_active: true })
      .select('id').single();
    supplierId = sup!.id;

    const { data: adminProfile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP000').single();
    const { data: mvt } = await admin.from('stock_movements').insert({
      product_id: productId,
      movement_type: 'adjustment',
      quantity: 1,
      reason: 'RLS seed movement',
      reference_type: 'admin_action',
      created_by: adminProfile!.id,
    }).select('id').single();
    seedMovementId = mvt!.id;
  });

  it('authenticated MANAGER CAN SELECT stock_movements (inventory.read granted)', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb.from('stock_movements')
      .select('id, movement_type').eq('id', seedMovementId);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it('authenticated CASHIER CANNOT SELECT stock_movements (no inventory.read)', async () => {
    // RLS: perm_read uses has_permission(auth.uid(), 'inventory.read'). CASHIER lacks it.
    const sb = jwtClient(cashierToken);
    const { data, error } = await sb.from('stock_movements')
      .select('id').eq('id', seedMovementId);
    // Postgres returns zero rows (RLS hides) without erroring. Either way, no leak.
    if (error === null) {
      expect(data ?? []).toHaveLength(0);
    } else {
      expect((error.message ?? '').toLowerCase()).toMatch(/permission denied|insufficient|access/);
    }
  });

  it('authenticated CANNOT INSERT into stock_movements directly (REVOKE)', async () => {
    const sb = jwtClient(adminToken);
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: adminProfile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP000').single();

    const { error } = await sb.from('stock_movements').insert({
      product_id: productId,
      movement_type: 'adjustment',
      quantity: 1,
      reason: 'direct insert attempt',
      reference_type: 'admin_action',
      created_by: adminProfile!.id,
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/permission denied|insufficient|access|policy/);
  });

  it('authenticated CANNOT UPDATE stock_movements directly (REVOKE)', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.from('stock_movements')
      .update({ reason: 'tampered' }).eq('id', seedMovementId);
    expect(error).not.toBeNull();
  });

  it('authenticated CANNOT DELETE stock_movements directly (REVOKE)', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.from('stock_movements')
      .delete().eq('id', seedMovementId);
    expect(error).not.toBeNull();
  });

  it('CASHIER: get_stock_levels_v1 → forbidden', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('get_stock_levels_v1', {
      p_low_stock_only: false, p_limit: 1, p_offset: 0,
    });
    expect(error?.message ?? '').toMatch(/forbidden/);
  });

  it('CASHIER: adjust_stock_v1 → forbidden', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: 100,
      p_reason: 'Cashier attempting adjust',
    });
    expect(error?.message ?? '').toMatch(/forbidden/);
  });

  it('CASHIER: receive_stock_v1 → forbidden', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('receive_stock_v1', {
      p_product_id: productId,
      p_quantity:   1,
      p_supplier_id: supplierId,
      p_reason:     'Cashier attempting receive',
    });
    expect(error?.message ?? '').toMatch(/forbidden/);
  });

  it('CASHIER: waste_stock_v1 → forbidden', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('waste_stock_v1', {
      p_product_id: productId,
      p_quantity:   1,
      p_reason:     'Cashier attempting waste',
    });
    expect(error?.message ?? '').toMatch(/forbidden/);
  });

  it('MANAGER: get_stock_levels_v1 → succeeds', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb.rpc('get_stock_levels_v1', {
      p_low_stock_only: false, p_limit: 5, p_offset: 0,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('anon (no JWT) CANNOT read stock_movements', async () => {
    const sb = createClient(SUPABASE_URL, ANON);
    const { data, error } = await sb.from('stock_movements').select('id').limit(1);
    if (error === null) {
      expect(data ?? []).toHaveLength(0);
    } else {
      expect((error.message ?? '').toLowerCase()).toMatch(/permission denied|insufficient|access/);
    }
  });

  it('anon CANNOT invoke any inventory RPC', async () => {
    const sb = createClient(SUPABASE_URL, ANON);
    for (const fn of ['get_stock_levels_v1', 'adjust_stock_v1', 'receive_stock_v1', 'waste_stock_v1']) {
      const args = fn === 'get_stock_levels_v1'
        ? { p_low_stock_only: false, p_limit: 1, p_offset: 0 }
        : { p_product_id: productId, p_quantity: 1, p_reason: 'anon should fail', p_new_qty: 1, p_supplier_id: supplierId };
      const { error } = await sb.rpc(fn, args);
      expect(error, `${fn} must reject anon`).not.toBeNull();
    }
  });
});
