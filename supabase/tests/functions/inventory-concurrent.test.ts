// supabase/tests/functions/inventory-concurrent.test.ts
// Session 12 — T16: concurrency / row-lock serialization for adjust_stock_v1.
//
// adjust_stock_v1 acquires a FOR UPDATE lock on `products` before computing
// the signed delta. Two parallel adjusts on the same product MUST therefore
// serialize: one wins the lock, runs first, the second runs against the
// updated current_stock. This test fires both calls via Promise.all and
// asserts:
//   - exactly 2 movement rows inserted (no dropped writes)
//   - sum of deltas reflects the second adjust's view of stock
//   - the audit_log has 2 rows (no silent lost update)
//
// We avoid testing a real adjust vs. a sale concurrency here because
// complete_order_with_payment requires a POS session + cart construction —
// out of scope for this single-table lock test.

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

describe('inventory concurrency — adjust_stock_v1 row-lock serialization', () => {
  let adminToken: string;
  let productId:  string;

  beforeAll(async () => {
    adminToken = await loginAs('EMP000', '123456');
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    productId = p!.id;
  });

  beforeEach(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('products').update({ current_stock: 100 }).eq('id', productId);
    // Wipe prior concurrent rows so we start clean.
    await admin.from('stock_movements').delete()
      .eq('product_id', productId)
      .ilike('reason', 'concurrent T16%');
  });

  it('T16: two parallel adjusts serialize via FOR UPDATE — no lost update', async () => {
    // Two separate client instances → two distinct PostgREST connections,
    // approximating two browser sessions. Both target the same product.
    const sb1 = jwtClient(adminToken);
    const sb2 = jwtClient(adminToken);

    const [r1, r2] = await Promise.all([
      sb1.rpc('adjust_stock_v1', {
        p_product_id: productId,
        p_new_qty: 150,
        p_reason:  'concurrent T16 path A (150)',
      }),
      sb2.rpc('adjust_stock_v1', {
        p_product_id: productId,
        p_new_qty: 200,
        p_reason:  'concurrent T16 path B (200)',
      }),
    ]);

    // Both calls must succeed (neither errors out due to lock contention —
    // the lock just sequences them).
    expect(r1.error, 'adjust A error').toBeNull();
    expect(r2.error, 'adjust B error').toBeNull();

    const data1 = r1.data as { new_current_stock: number; movement_id: string };
    const data2 = r2.data as { new_current_stock: number; movement_id: string };
    expect(data1.movement_id).toBeTruthy();
    expect(data2.movement_id).toBeTruthy();
    expect(data1.movement_id).not.toBe(data2.movement_id);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: rows } = await admin.from('stock_movements')
      .select('id, quantity, reason, created_at')
      .eq('product_id', productId)
      .ilike('reason', 'concurrent T16%')
      .order('created_at', { ascending: true });
    expect(rows).toHaveLength(2);

    // Final on-hand must equal the LAST adjust's target (deterministic outcome).
    // The "winner" of the lock race is whichever the planner picked first; either
    // way the FINAL value equals the new_qty supplied by the second-to-run call.
    const { data: prod } = await admin.from('products')
      .select('current_stock').eq('id', productId).single();
    const finalStock = Number(prod!.current_stock);
    expect([150, 200]).toContain(finalStock);

    // Conservation: sum of inserted deltas = finalStock - 100 (baseline).
    const totalDelta = (rows ?? []).reduce((acc, r) => acc + Number(r.quantity), 0);
    expect(totalDelta).toBe(finalStock - 100);

    // Audit log: 2 rows, both pointing at our movement_ids.
    const { count: auditCount } = await admin.from('audit_log')
      .select('*', { count: 'exact', head: true })
      .in('subject_id', [data1.movement_id, data2.movement_id])
      .eq('action', 'stock.movement');
    expect(auditCount).toBe(2);
  });

  it('T16b: parallel adjust + waste preserve total quantity invariant', async () => {
    // 100 baseline.
    // path A: adjust to 130  (+30)
    // path B: waste 10       (-10)
    // Final accepted range: either {after A: 130 → -10 = 120} or
    // {after B: 90 → +40 = 130}; both are consistent with conservation.
    const sb1 = jwtClient(adminToken);
    const sb2 = jwtClient(adminToken);

    const [rA, rB] = await Promise.all([
      sb1.rpc('adjust_stock_v1', {
        p_product_id: productId,
        p_new_qty: 130,
        p_reason: 'concurrent T16 path A adjust',
      }),
      sb2.rpc('waste_stock_v1', {
        p_product_id: productId,
        p_quantity: 10,
        p_reason: 'concurrent T16 path B waste',
      }),
    ]);
    expect(rA.error, 'adjust error').toBeNull();
    expect(rB.error, 'waste error').toBeNull();

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: prod } = await admin.from('products')
      .select('current_stock').eq('id', productId).single();
    const finalStock = Number(prod!.current_stock);

    const { data: rows } = await admin.from('stock_movements')
      .select('quantity, movement_type, reason').eq('product_id', productId)
      .ilike('reason', 'concurrent T16%');
    expect(rows).toHaveLength(2);
    const sum = (rows ?? []).reduce((acc, r) => acc + Number(r.quantity), 0);
    // 100 + sum(deltas) == final_stock — exact conservation, no lost update.
    expect(100 + sum).toBe(finalStock);
  });
});
