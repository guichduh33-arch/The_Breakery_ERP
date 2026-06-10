// supabase/tests/functions/waste-stock.test.ts
// Session 12 — Live integration tests for waste_stock_v1 RPC.
//
// Coverage:
//   - Happy path (MANAGER, qty within stock, negative movement recorded)
//   - Insufficient_stock when qty > on-hand (P0002)
//   - Reason required (short / empty rejected)
//   - Idempotency replay
//   - quantity <= 0 rejected

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

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('waste_stock_v1 RPC — integration', () => {
  let managerToken: string;
  let productId:    string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    productId = p!.id;
  });

  beforeEach(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('products').update({ current_stock: 100 }).eq('id', productId);
  });

  it('manager happy path: decrement stock + insert negative movement', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb.rpc('waste_stock_v1', {
      p_product_id: productId,
      p_quantity:   8,
      p_reason:     'Expired stock thrown out',
    });
    expect(error).toBeNull();
    const result = data as { movement_id: string; new_current_stock: number };
    expect(Number(result.new_current_stock)).toBe(92);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: mvt } = await admin.from('stock_movements')
      .select('quantity, movement_type, reason')
      .eq('id', result.movement_id).single();
    // Caller supplies positive qty; the RPC negates internally for the ledger row.
    expect(Number(mvt!.quantity)).toBe(-8);
    expect(mvt!.movement_type).toBe('waste');
    expect(mvt!.reason).toBe('Expired stock thrown out');
  });

  it('manager: qty > current_stock → insufficient_stock', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await sb.rpc('waste_stock_v1', {
      p_product_id: productId,
      p_quantity:   500,  // baseline is 100
      p_reason:     'Should fail: not enough on hand',
    });
    expect(error?.message ?? '').toMatch(/insufficient_stock/);
  });

  it('manager: reason missing/short → reason_required (from record_stock_movement_v1)', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await sb.rpc('waste_stock_v1', {
      p_product_id: productId,
      p_quantity:   1,
      p_reason:     'no',
    });
    expect(error?.message ?? '').toMatch(/reason_required/);
  });

  it('idempotency: same key on retry returns idempotent_replay=true, single row', async () => {
    const sb = jwtClient(managerToken);
    const key = '00000000-0000-0000-0000-00000000cdef';

    const r1 = await sb.rpc('waste_stock_v1', {
      p_product_id: productId,
      p_quantity:   5,
      p_reason:     'Waste idempotency',
      p_idempotency_key: key,
    });
    expect(r1.error).toBeNull();
    const id1 = (r1.data as { movement_id: string }).movement_id;

    const r2 = await sb.rpc('waste_stock_v1', {
      p_product_id: productId,
      p_quantity:   5,
      p_reason:     'Waste idempotency retry',
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
    await admin.from('stock_movements').delete().eq('idempotency_key', key);
  });

  it('manager: quantity <= 0 → quantity_must_be_positive', async () => {
    const sb = jwtClient(managerToken);
    for (const qty of [0, -3]) {
      const { error } = await sb.rpc('waste_stock_v1', {
        p_product_id: productId,
        p_quantity:   qty,
        p_reason:     'Non-positive qty should be rejected',
      });
      expect(error?.message ?? '', `qty=${qty}`).toMatch(/quantity_must_be_positive/);
    }
  });

  it('manager: nonexistent product_id → product_not_found', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await sb.rpc('waste_stock_v1', {
      p_product_id: '00000000-0000-0000-0000-000000000000',
      p_quantity:   1,
      p_reason:     'Bogus product id',
    });
    expect(error?.message ?? '').toMatch(/product_not_found/);
  });
});
