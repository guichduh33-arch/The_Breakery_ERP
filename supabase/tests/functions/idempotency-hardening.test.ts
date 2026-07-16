// supabase/tests/functions/idempotency-hardening.test.ts
// Session 25 / Phase 2.A.2 — Vitest live tests for idempotency hardening
// (Wave 1 deliverable on V3 dev `ikcyvlovptebroadgtvd`).
//
// Couvre :
//   - create_tablet_order_v3 (RPC, idempotent replay via p_client_uuid ;
//     bumped from v2 in Session 59 / 17 D1.1 — v2 is DROPped on cloud)
//   - refund-order EF (header `x-manager-pin` + `x-idempotency-key`, hard cutover)
//
// 5 scénarios :
//   TS1 : create_tablet_order_v3 happy path via supabase-js client → valid UUID order_id
//   TS2 : create_tablet_order_v3 retry SAME clientUuid → same order_id ; 1 row only in
//         tablet_order_idempotency_keys for that client_uuid
//   TS3 : refund-order EF with x-manager-pin + x-idempotency-key → 200, idempotent_replay=false
//   TS4 : refund-order EF retry SAME x-idempotency-key → 200, idempotent_replay=true,
//         audit_logs row action='refund.replay' avec metadata.idempotency_key match
//   TS5 : refund-order EF WITHOUT x-manager-pin → 400, body { error: 'missing_manager_pin' }
//
// Bootstrap :
//   - admin client (service role) → seed product + create paid order via direct INSERTs
//     (même pattern que le pgTAP `idempotency_hardening.test.sql`).
//   - cashier client (EMP001 / PIN 567890) → JWT pour appeler create_tablet_order_v3 RPC
//     ET pour le Bearer token du refund EF.
//   - manager PIN 111111 (EMP003) passé via header x-manager-pin.
//
// Cleanup :
//   - Tous les rows créés utilisent des UUIDs déterministes préfixés `feedca50-...-25NN`
//     pour faciliter le purge `WHERE id IN (...)` en afterAll.
//   - Cleanup ordre : refund_payments → refund_lines → refunds → stock_movements →
//     audit_logs → tablet_order_idempotency_keys → order_payments → order_items →
//     orders → pos_sessions → products.
//   - Service-role bypasses RLS donc les DELETE passent même sur les tables
//     append-only (stock_movements REVOKE UPDATE/DELETE pour `authenticated`).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAsFull, loginAsViaPinEF, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  ?? process.env.SUPABASE_URL
  ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const REFUND_FN_URL = `${SUPABASE_URL}/functions/v1/refund-order`;

// Deterministic test IDs (cloud-safe : prefixed so cleanup can target them only).
const TEST_PRODUCT_ID    = 'feedca50-0000-0000-0000-000000002501';
const TEST_SESSION_ID    = 'feedca50-0000-0000-0000-000000002502';
const TEST_ORDER_ID      = 'feedca50-0000-0000-0000-000000002503';
const TEST_ORDER_ITEM_ID = 'feedca50-0000-0000-0000-000000002504';

// Cashier PIN (EMP001 / 567890) — used for refund EF tests (TS3/TS4/TS5).
// Refund RPC checks manager perm via p_authorized_by ; cashier just needs to be authenticated.
const CASHIER_EMPLOYEE = 'EMP001';
const CASHIER_PIN      = '567890';
// Waiter PIN (EMP002 / 567800) — used for create_tablet_order_v3 tests (TS1/TS2).
// waiter role has `sales.create` perm ; CASHIER does NOT (seed 20260507000002).
const WAITER_EMPLOYEE  = 'EMP002';
const WAITER_PIN       = '567800';
// Manager PIN passed in x-manager-pin header (EMP003 / 111111 per seed.sql).
const MANAGER_PIN      = '111111';

// Track client_uuids created during TS1/TS2 so afterAll can purge.
const createdClientUuids: string[] = [];
// Track refund idempotency keys created during TS3/TS4 so afterAll can purge audit_logs.
const createdRefundIdempKeys: string[] = [];

async function loginAs(employeeCode: string, _pin: string): Promise<{
  accessToken: string;
  profileId:   string;
}> {
  const r = await loginAsFull(employeeCode);
  return { accessToken: r.token, profileId: r.profileId };
}

// Type-erased rpc helper (generated types may lag staging).
// MUST .bind(sb) — supabase-js `rpc` is a method that reads `this.fetch.rest` ;
// unbound returns 'Cannot read properties of undefined (reading "rest")'.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpc(sb: SupabaseClient): (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string; code?: string } | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb.rpc.bind(sb) as any;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('S25 idempotency hardening — Vitest live', () => {
  let cashierToken:   string;
  let cashierProfile: string;
  let waiterToken:    string;
  let waiterProfile:  string;

  beforeAll(async () => {
    if (!SERVICE) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY env var not set');
    }
    const admin = createClient(SUPABASE_URL, SERVICE);

    // 1a) Cashier login (refund EF tests TS3/TS4/TS5 — caller just needs to be authenticated).
    // S77: the refund-order EF validates the CUSTOM PIN-JWT (HS256) and rejects
    // GoTrue session tokens ('not_authenticated') — this token must come from
    // the auth-verify-pin EF itself.
    cashierToken = await loginAsViaPinEF(CASHIER_EMPLOYEE, CASHIER_PIN);
    const cashier = await loginAs(CASHIER_EMPLOYEE, CASHIER_PIN);
    cashierProfile = cashier.profileId;

    // 1b) Waiter login (tablet RPC tests TS1/TS2 — waiter has sales.create perm, CASHIER does not).
    const waiter = await loginAs(WAITER_EMPLOYEE, WAITER_PIN);
    waiterToken   = waiter.accessToken;
    waiterProfile = waiter.profileId;

    // 2) Resolve a category id (FK on products.category_id).
    const { data: cat } = await admin.from('categories').select('id').limit(1).single();
    if (!cat) throw new Error('No category in DB — seed not loaded');

    // 3) Pre-clean : if a previous run crashed mid-flight, purge by deterministic IDs.
    await preCleanup(admin);

    // 4) Test product (idempotent UPSERT).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('products').insert({
      id:                  TEST_PRODUCT_ID,
      sku:                 'VITEST-IDEMP-PROD',
      name:                'Vitest Idempotency Product',
      category_id:         cat.id,
      retail_price:        20000,
      current_stock:       1000,
      min_stock_threshold: 0,
    } as any);

    // 5) Close any pre-existing open session for this cashier (EXCLUDE constraint
    // one_open_session_per_user). Best-effort.
    await admin.from('pos_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: cashierProfile, closing_cash: 0 })
      .eq('opened_by', cashierProfile).eq('status', 'open');

    // 6) Fresh open session.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: sessErr } = await admin.from('pos_sessions').insert({
      id:           TEST_SESSION_ID,
      opened_by:    cashierProfile,
      opened_at:    new Date().toISOString(),
      opening_cash: 0,
      status:       'open',
    } as any);
    if (sessErr) throw new Error(`Session insert failed: ${JSON.stringify(sessErr)}`);

    // 7) Fresh PAID order for TS3/TS4 refund tests (direct INSERTs bypassing
    // complete_order RPC — accepted shortcut, see pgTAP file rationale).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: orderErr } = await admin.from('orders').insert({
      id:           TEST_ORDER_ID,
      order_number: 'VITEST-IDEMP-' + TEST_ORDER_ID.substring(0, 8),
      session_id:   TEST_SESSION_ID,
      served_by:    cashierProfile,
      order_type:   'dine_in',
      status:       'paid',
      subtotal:     40000,
      tax_amount:   0,
      total:        40000,
      paid_at:      new Date().toISOString(),
    } as any);
    if (orderErr) throw new Error(`Order insert failed: ${JSON.stringify(orderErr)}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('order_items').insert({
      id:             TEST_ORDER_ITEM_ID,
      order_id:       TEST_ORDER_ID,
      product_id:     TEST_PRODUCT_ID,
      name_snapshot:  'Vitest Idempotency Product',
      unit_price:     20000,
      quantity:       2,
      line_total:     40000,
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('order_payments').insert({
      order_id: TEST_ORDER_ID,
      method:   'cash',
      amount:   40000,
      paid_at:  new Date().toISOString(),
    } as any);
  });

  afterAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    await fullCleanup(admin);
  });

  // ===========================================================================
  // TS1 — create_tablet_order_v3 happy path
  // ===========================================================================
  it('TS1: create_tablet_order_v3 happy path returns a valid UUID order_id', async () => {
    const sb = jwtClient(waiterToken);
    const clientUuid = crypto.randomUUID();
    createdClientUuids.push(clientUuid);

    const { data, error } = await rpc(sb)('create_tablet_order_v4', {
      p_client_uuid:  clientUuid,
      p_waiter_id:    waiterProfile,
      p_table_number: 'TS1',
      p_order_type:   'dine_in',
      p_items: [{
        product_id: TEST_PRODUCT_ID,
        quantity:   1,
        unit_price: 20000,
        modifiers:  [],
      }],
    });

    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    expect(data).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  // ===========================================================================
  // TS2 — retry SAME clientUuid returns same order_id, no double insert
  // ===========================================================================
  it('TS2: retry with same clientUuid returns same order_id, 1 row in idempotency table', async () => {
    const sb = jwtClient(waiterToken);
    const admin = createClient(SUPABASE_URL, SERVICE);
    const clientUuid = crypto.randomUUID();
    createdClientUuids.push(clientUuid);

    const args = {
      p_client_uuid:  clientUuid,
      p_waiter_id:    waiterProfile,
      p_table_number: 'TS2',
      p_order_type:   'dine_in' as const,
      p_items: [{
        product_id: TEST_PRODUCT_ID,
        quantity:   1,
        unit_price: 20000,
        modifiers:  [],
      }],
    };

    const first  = await rpc(sb)('create_tablet_order_v4', args);
    expect(first.error).toBeNull();
    expect(typeof first.data).toBe('string');

    // Replay : different args on purpose (table_number changed) — replay must ignore.
    const second = await rpc(sb)('create_tablet_order_v4', {
      ...args,
      p_table_number: 'TS2-REPLAY',
      p_items: [{
        product_id: TEST_PRODUCT_ID,
        quantity:   99,
        unit_price: 99999,
        modifiers:  [],
      }],
    });
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    // Verify exactly 1 row in idempotency table for this client_uuid.
    const { data: keys } = await admin
      .from('tablet_order_idempotency_keys')
      .select('order_id')
      .eq('client_uuid', clientUuid);
    expect(keys).toHaveLength(1);
    expect((keys![0] as { order_id: string }).order_id).toBe(first.data);
  });

  // ===========================================================================
  // TS3 — refund-order EF with PIN header + idempotency key → idempotent_replay=false
  // ===========================================================================
  it('TS3: refund-order EF with x-manager-pin + x-idempotency-key → 200 idempotent_replay=false', async () => {
    const idempKey = crypto.randomUUID();
    createdRefundIdempKeys.push(idempKey);

    const res = await fetch(REFUND_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        Authorization:       `Bearer ${cashierToken}`,
        'x-manager-pin':     MANAGER_PIN,
        'x-idempotency-key': idempKey,
      },
      body: JSON.stringify({
        order_id: TEST_ORDER_ID,
        lines:    [{ order_item_id: TEST_ORDER_ITEM_ID, qty: 1 }],
        tenders:  [{ method: 'cash', amount: 20000 }],
        reason:   'TS3 first refund call (vitest live)',
      }),
    });

    const body = await res.json();
    expect(res.status, `body=${JSON.stringify(body)}`).toBe(200);
    expect(body.refund_id).toBeTruthy();
    // S78 (D-6) : refund_order_rpc_v5 n'émet idempotent_replay QUE sur le
    // replay (convention projet : premier appel = enveloppe sans le flag).
    expect(body.idempotent_replay).not.toBe(true);
  });

  // ===========================================================================
  // TS4 — refund-order EF retry SAME idempotency_key → idempotent_replay=true + audit row
  // ===========================================================================
  it('TS4: refund-order EF retry same x-idempotency-key → idempotent_replay=true + audit_logs row', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const idempKey = crypto.randomUUID();
    createdRefundIdempKeys.push(idempKey);

    const payload = JSON.stringify({
      order_id: TEST_ORDER_ID,
      lines:    [{ order_item_id: TEST_ORDER_ITEM_ID, qty: 1 }],
      tenders:  [{ method: 'cash', amount: 20000 }],
      reason:   'TS4 retry test (vitest live)',
    });

    const headers = {
      'Content-Type':      'application/json',
      Authorization:       `Bearer ${cashierToken}`,
      'x-manager-pin':     MANAGER_PIN,
      'x-idempotency-key': idempKey,
    };

    // First call : succeeds (no replay).
    const first = await fetch(REFUND_FN_URL, { method: 'POST', headers, body: payload });
    const firstBody = await first.json();
    expect(first.status, `body=${JSON.stringify(firstBody)}`).toBe(200);
    // S78 : cf. TS3 — le flag n'apparaît que sur replay.
    expect(firstBody.idempotent_replay).not.toBe(true);

    // Second call : same idempotency key → replay envelope.
    const second = await fetch(REFUND_FN_URL, { method: 'POST', headers, body: payload });
    const secondBody = await second.json();
    expect(second.status, `body=${JSON.stringify(secondBody)}`).toBe(200);
    expect(secondBody.idempotent_replay).toBe(true);
    expect(secondBody.refund_id).toBe(firstBody.refund_id);

    // Verify audit_logs row exists for the replay (best-effort : EF logs via
    // admin client, may be slightly async). Retry up to 3x avec 200ms wait.
    let auditRow: { action: string; metadata: { idempotency_key?: string } } | null = null;
    for (let attempt = 0; attempt < 3 && !auditRow; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 200));
      const { data } = await admin
        .from('audit_logs')
        .select('action, metadata')
        .eq('action', 'refund.replay')
        .eq('entity_id', TEST_ORDER_ID)
        .filter('metadata->>idempotency_key', 'eq', idempKey)
        .maybeSingle();
      if (data) auditRow = data as { action: string; metadata: { idempotency_key?: string } };
    }
    expect(auditRow).not.toBeNull();
    expect(auditRow!.action).toBe('refund.replay');
    expect(auditRow!.metadata.idempotency_key).toBe(idempKey);
  });

  // ===========================================================================
  // TS5 — refund-order EF WITHOUT x-manager-pin → 400 missing_manager_pin (hard cutover)
  // ===========================================================================
  it('TS5: refund-order EF without x-manager-pin → 400 missing_manager_pin', async () => {
    const res = await fetch(REFUND_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${cashierToken}`,
        // x-manager-pin OMITTED on purpose
      },
      body: JSON.stringify({
        order_id: TEST_ORDER_ID,
        lines:    [{ order_item_id: TEST_ORDER_ITEM_ID, qty: 1 }],
        tenders:  [{ method: 'cash', amount: 20000 }],
        reason:   'TS5 no-PIN test (vitest live)',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_manager_pin');
  });
});

// ===========================================================================
// Cleanup helpers
// ===========================================================================

async function preCleanup(admin: SupabaseClient): Promise<void> {
  // If a previous crashed run left rows behind, purge by deterministic IDs.
  // Order matters : children → parents.
  try {
    // Find refunds referencing TEST_ORDER_ID (may be many across runs).
    const { data: refunds } = await admin.from('refunds')
      .select('id').eq('order_id', TEST_ORDER_ID);
    const refundIds = (refunds ?? []).map((r: { id: string }) => r.id);

    if (refundIds.length > 0) {
      await admin.from('refund_payments').delete().in('refund_id', refundIds);
      await admin.from('refund_lines').delete().in('refund_id', refundIds);
      await admin.from('stock_movements').delete()
        .eq('reference_type', 'refunds').in('reference_id', refundIds);
      await admin.from('refunds').delete().in('id', refundIds);
    }

    // Audit_logs from previous refund.replay rows for this order.
    await admin.from('audit_logs').delete()
      .eq('action', 'refund.replay').eq('entity_id', TEST_ORDER_ID);
    await admin.from('audit_logs').delete()
      .eq('action', 'order.refund').eq('entity_id', TEST_ORDER_ID);

    await admin.from('order_payments').delete().eq('order_id', TEST_ORDER_ID);
    await admin.from('order_items').delete().eq('order_id', TEST_ORDER_ID);
    await admin.from('orders').delete().eq('id', TEST_ORDER_ID);

    await admin.from('pos_sessions').delete().eq('id', TEST_SESSION_ID);
    await admin.from('products').delete().eq('id', TEST_PRODUCT_ID);
  } catch (_) {
    // Best-effort.
  }
}

async function fullCleanup(admin: SupabaseClient): Promise<void> {
  // 1) Refund-side cleanup (TS3 + TS4 created real refunds).
  try {
    const { data: refunds } = await admin.from('refunds')
      .select('id').eq('order_id', TEST_ORDER_ID);
    const refundIds = (refunds ?? []).map((r: { id: string }) => r.id);

    if (refundIds.length > 0) {
      await admin.from('refund_payments').delete().in('refund_id', refundIds);
      await admin.from('refund_lines').delete().in('refund_id', refundIds);
      await admin.from('stock_movements').delete()
        .eq('reference_type', 'refunds').in('reference_id', refundIds);
      await admin.from('refunds').delete().in('id', refundIds);
    }
  } catch (_) { /* ignore */ }

  // 2) Audit logs created by the refund EF (refund.replay for TS4 + order.refund for TS3/TS4).
  try {
    if (createdRefundIdempKeys.length > 0) {
      for (const key of createdRefundIdempKeys) {
        await admin.from('audit_logs').delete()
          .eq('action', 'refund.replay')
          .filter('metadata->>idempotency_key', 'eq', key);
      }
    }
    await admin.from('audit_logs').delete()
      .eq('action', 'order.refund').eq('entity_id', TEST_ORDER_ID);
  } catch (_) { /* ignore */ }

  // 3) Tablet idempotency keys + the orders they spawned (TS1 + TS2).
  try {
    if (createdClientUuids.length > 0) {
      const { data: keys } = await admin.from('tablet_order_idempotency_keys')
        .select('order_id').in('client_uuid', createdClientUuids);
      const spawnedOrderIds = (keys ?? []).map((k: { order_id: string }) => k.order_id);

      await admin.from('tablet_order_idempotency_keys').delete()
        .in('client_uuid', createdClientUuids);

      if (spawnedOrderIds.length > 0) {
        await admin.from('order_items').delete().in('order_id', spawnedOrderIds);
        await admin.from('order_payments').delete().in('order_id', spawnedOrderIds);
        await admin.from('orders').delete().in('id', spawnedOrderIds);
      }
    }
  } catch (_) { /* ignore */ }

  // 4) The pre-built paid order (TEST_ORDER_ID).
  try {
    await admin.from('order_payments').delete().eq('order_id', TEST_ORDER_ID);
    await admin.from('order_items').delete().eq('order_id', TEST_ORDER_ID);
    await admin.from('orders').delete().eq('id', TEST_ORDER_ID);
  } catch (_) { /* ignore */ }

  // 5) Session (close before delete in case any FK still references it).
  try {
    await admin.from('pos_sessions').delete().eq('id', TEST_SESSION_ID);
  } catch (_) { /* ignore */ }

  // 6) Test product.
  try {
    await admin.from('stock_movements').delete().eq('product_id', TEST_PRODUCT_ID);
    await admin.from('products').delete().eq('id', TEST_PRODUCT_ID);
  } catch (_) { /* ignore */ }
}
