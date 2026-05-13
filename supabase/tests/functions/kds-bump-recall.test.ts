// supabase/tests/functions/kds-bump-recall.test.ts
// Session 13 / Phase 4.B — live cycle :
//   create order → start prep → bump → undo → bump again → recall.
//
// Skips gracefully when env vars are missing (CI dry-run on local without
// Supabase credentials). Reuses the loginAs/jwtClient pattern from
// inventory-f1-lots.test.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

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

function jwtClient(token: string) {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describeLive('KDS extensions — live RPC cycle', () => {
  let cashierToken: string;
  let orderId: string;
  let itemId:  string;

  beforeAll(async () => {
    cashierToken = await loginAs('EMP004', '111111'); // cashier seeded by V3
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Pick first product + category.
    const { data: prod } = await admin.from('products')
      .select('id, category_id').not('category_id', 'is', null).limit(1).single();
    if (!prod) throw new Error('No product available');

    // Create a draft order.
    const { data: ord, error: ordErr } = await admin.from('orders')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
      .insert({
        order_number: `KDS-LIVE-${Date.now()}`,
        order_type: 'dine_in',
        status: 'draft',
        subtotal: 0,
        tax_amount: 0,
        total: 0,
      } as any)
      .select('id').single();
    if (ordErr || !ord) throw new Error(`Order insert failed: ${ordErr?.message}`);
    orderId = ord.id;

    // Create an order_item in 'preparing' (already locked → KDS view).
    const { data: oi, error: oiErr } = await admin.from('order_items')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
      .insert({
        order_id: orderId,
        product_id: prod.id,
        name_snapshot: 'KDS Live Test',
        unit_price: 1000,
        quantity: 1,
        line_total: 1000,
        kitchen_status: 'preparing',
        dispatch_station: 'kitchen',
        is_locked: true,
        sent_to_kitchen_at: new Date().toISOString(),
      } as any)
      .select('id').single();
    if (oiErr || !oi) throw new Error(`Item insert failed: ${oiErr?.message}`);
    itemId = oi.id;
  }, 30_000);

  it('full cycle: start prep → bump → undo → bump again → recall', async () => {
    const c = jwtClient(cashierToken);

    // 1. start_prep_timer (already preparing — should set prep_started_at).
    const r1 = await c.rpc('kds_start_prep_timer_v1', { p_order_item_id: itemId });
    expect(r1.error).toBeNull();

    // 2. bump
    const r2 = await c.rpc('kds_bump_item_v1', {
      p_order_item_id: itemId,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(r2.error).toBeNull();

    // Verify the item is ready with bumped_at set.
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: row1 } = await admin.from('order_items')
      .select('kitchen_status, bumped_at, ready_at, prep_started_at')
      .eq('id', itemId).single();
    expect((row1 as any).kitchen_status).toBe('ready');
    expect((row1 as any).bumped_at).toBeTruthy();
    expect((row1 as any).ready_at).toBeTruthy();
    expect((row1 as any).prep_started_at).toBeTruthy();

    // 3. undo (within 60s)
    const r3 = await c.rpc('kds_undo_bump_v1', { p_order_item_id: itemId });
    expect(r3.error).toBeNull();
    const { data: row2 } = await admin.from('order_items')
      .select('kitchen_status, bumped_at')
      .eq('id', itemId).single();
    expect((row2 as any).kitchen_status).toBe('preparing');
    expect((row2 as any).bumped_at).toBeNull();

    // 4. bump again
    const r4 = await c.rpc('kds_bump_item_v1', { p_order_item_id: itemId });
    expect(r4.error).toBeNull();

    // 5. mark served (use existing RPC) so recall has something to do.
    const r5 = await c.rpc('mark_item_served', { p_item_id: itemId });
    expect(r5.error).toBeNull();
    const { data: row3 } = await admin.from('order_items')
      .select('kitchen_status').eq('id', itemId).single();
    expect((row3 as any).kitchen_status).toBe('served');

    // 6. recall
    const r6 = await c.rpc('kds_recall_order_v1', {
      p_order_id: orderId,
      p_reason: 'live cycle test',
    });
    expect(r6.error).toBeNull();
    expect(r6.data).toBeGreaterThanOrEqual(1);

    const { data: row4 } = await admin.from('order_items')
      .select('kitchen_status, served_at, served_by, ready_at, bumped_at')
      .eq('id', itemId).single();
    expect((row4 as any).kitchen_status).toBe('preparing');
    expect((row4 as any).served_at).toBeNull();
    expect((row4 as any).bumped_at).toBeNull();

    // 7. audit_logs row exists for the recall.
    const { data: audit } = await admin.from('audit_logs')
      .select('action, entity_type, entity_id, metadata')
      .eq('action', 'kds.recall')
      .eq('entity_id', orderId)
      .limit(1).single();
    expect((audit as any).entity_type).toBe('order');
    expect((audit as any).metadata.items_recalled).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('undo expired window raises P0012', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const c = jwtClient(cashierToken);

    // Force bump → then backdate bumped_at to 2 minutes ago.
    await c.rpc('kds_bump_item_v1', { p_order_item_id: itemId });
    await admin.from('order_items')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
      .update({ bumped_at: new Date(Date.now() - 2 * 60_000).toISOString() } as any)
      .eq('id', itemId);

    const r = await c.rpc('kds_undo_bump_v1', { p_order_item_id: itemId });
    expect(r.error).not.toBeNull();
    expect(r.error?.code).toBe('P0012');
  }, 15_000);
});
