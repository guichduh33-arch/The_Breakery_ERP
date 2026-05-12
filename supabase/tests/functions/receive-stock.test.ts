// supabase/tests/functions/receive-stock.test.ts
// Session 12 — Live integration tests for receive_stock_v1 RPC.
//
// Coverage:
//   - Happy path (MANAGER, active supplier, qty added, supplier_id stamped)
//   - Inactive supplier → supplier_not_found_or_inactive (P0002)
//   - Idempotency replay
//   - qty <= 0 rejected
//   - Default reason "Receipt from <code>" when caller omits reason
//   - Unit cost is persisted when supplied

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

describe('receive_stock_v1 RPC — integration', () => {
  let managerToken: string;
  let productId:    string;
  let activeSupplierId:   string;
  let activeSupplierCode: string;
  let inactiveSupplierId: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    productId = p!.id;

    // Seed two test suppliers (one active, one inactive). ON CONFLICT keeps the
    // suite idempotent across runs.
    const activeCode = `RCV-ACTIVE-${Date.now()}`;
    const inactiveCode = `RCV-INACTIVE-${Date.now()}`;
    const { data: act, error: actErr } = await admin.from('suppliers')
      .insert({ code: activeCode, name: 'Active receiver supplier', is_active: true })
      .select('id, code').single();
    if (actErr) throw actErr;
    activeSupplierId   = act!.id;
    activeSupplierCode = act!.code;

    const { data: inact, error: inactErr } = await admin.from('suppliers')
      .insert({ code: inactiveCode, name: 'Inactive receiver supplier', is_active: false })
      .select('id').single();
    if (inactErr) throw inactErr;
    inactiveSupplierId = inact!.id;
  });

  beforeEach(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('products').update({ current_stock: 100 }).eq('id', productId);
  });

  it('manager happy path: adds quantity, links supplier_id, movement_type=purchase', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb.rpc('receive_stock_v1', {
      p_product_id: productId,
      p_quantity:   30,
      p_supplier_id: activeSupplierId,
      p_reason:     'PO-RECEIVE-1',
    });
    expect(error).toBeNull();
    const result = data as { movement_id: string; new_current_stock: number };
    expect(Number(result.new_current_stock)).toBe(130);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: mvt } = await admin.from('stock_movements')
      .select('quantity, movement_type, supplier_id, reason')
      .eq('id', result.movement_id).single();
    expect(Number(mvt!.quantity)).toBe(30);
    expect(mvt!.movement_type).toBe('purchase');
    expect(mvt!.supplier_id).toBe(activeSupplierId);
    expect(mvt!.reason).toBe('PO-RECEIVE-1');
  });

  it('manager: inactive supplier → supplier_not_found_or_inactive', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await sb.rpc('receive_stock_v1', {
      p_product_id: productId,
      p_quantity:   10,
      p_supplier_id: inactiveSupplierId,
      p_reason:     'Should fail on inactive supplier',
    });
    expect(error?.message ?? '').toMatch(/supplier_not_found_or_inactive/);
  });

  it('manager: nonexistent supplier UUID → supplier_not_found_or_inactive', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await sb.rpc('receive_stock_v1', {
      p_product_id: productId,
      p_quantity:   5,
      p_supplier_id: '00000000-0000-0000-0000-000000000000',
      p_reason:     'Bogus supplier id',
    });
    expect(error?.message ?? '').toMatch(/supplier_not_found_or_inactive/);
  });

  it('idempotency replay returns same movement_id', async () => {
    const sb = jwtClient(managerToken);
    const key = '00000000-0000-0000-0000-00000000bcde';

    const r1 = await sb.rpc('receive_stock_v1', {
      p_product_id: productId,
      p_quantity:   12,
      p_supplier_id: activeSupplierId,
      p_reason:     'idempotency first',
      p_idempotency_key: key,
    });
    expect(r1.error).toBeNull();
    const id1 = (r1.data as { movement_id: string }).movement_id;

    const r2 = await sb.rpc('receive_stock_v1', {
      p_product_id: productId,
      p_quantity:   12,
      p_supplier_id: activeSupplierId,
      p_reason:     'idempotency second',
      p_idempotency_key: key,
    });
    expect(r2.error).toBeNull();
    const result2 = r2.data as { movement_id: string; idempotent_replay: boolean };
    expect(result2.movement_id).toBe(id1);
    expect(result2.idempotent_replay).toBe(true);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { count } = await admin.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(1);
    // Cleanup.
    await admin.from('stock_movements').delete().eq('idempotency_key', key);
  });

  it('manager: quantity <= 0 rejected', async () => {
    const sb = jwtClient(managerToken);
    for (const qty of [0, -1, -100]) {
      const { error } = await sb.rpc('receive_stock_v1', {
        p_product_id: productId,
        p_quantity:   qty,
        p_supplier_id: activeSupplierId,
        p_reason:     'Should fail on non-positive qty',
      });
      expect(error?.message ?? '', `qty=${qty}`).toMatch(/quantity_must_be_positive/);
    }
  });

  it('default reason "Receipt from <code>" applied when p_reason is NULL', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb.rpc('receive_stock_v1', {
      p_product_id: productId,
      p_quantity:   7,
      p_supplier_id: activeSupplierId,
      // Omit p_reason entirely — the wrapper must default to "Receipt from <code>".
    });
    expect(error).toBeNull();
    const result = data as { movement_id: string };

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: mvt } = await admin.from('stock_movements')
      .select('reason').eq('id', result.movement_id).single();
    expect(mvt!.reason).toBe(`Receipt from ${activeSupplierCode}`);
  });

  it('unit_cost is persisted when supplied', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb.rpc('receive_stock_v1', {
      p_product_id: productId,
      p_quantity:   3,
      p_supplier_id: activeSupplierId,
      p_unit_cost:   15000,
      p_reason:      'Unit cost capture',
    });
    expect(error).toBeNull();
    const result = data as { movement_id: string };

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: mvt } = await admin.from('stock_movements')
      .select('unit_cost').eq('id', result.movement_id).single();
    expect(Number(mvt!.unit_cost)).toBe(15000);
  });
});
