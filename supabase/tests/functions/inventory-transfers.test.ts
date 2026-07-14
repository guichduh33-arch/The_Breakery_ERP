// supabase/tests/functions/inventory-transfers.test.ts
// Session 12 / Phase 3 — Live integration tests for internal-transfer RPCs.
//
// Coverage:
//   1. Full happy cycle (pending → receive) — 2 items, 4 stock_movements, section_stock deltas.
//   2. send_directly=true — immediate receive, 2 movements emitted (1 item).
//   3. Cancel before receive — metadata.cancel_reason persisted.
//   4. Idempotency on create — second call returns same transfer_id + idempotent_replay=true.
//   5. Idempotency on receive — second receive does NOT double movements.
//   6. RLS / permission — CASHIER forbidden on create + receive.
//   7. from_section_id = to_section_id rejected.
//
// Patterns:
//   - PIN auth via auth-verify-pin Edge Function (HS256 JWT) attached to a fresh
//     supabase client per role (mirrors receive-stock.test.ts).
//   - Service-role client (admin) used only for setup/inspection (bypasses RLS).
//   - Each scenario uses unique idempotency UUIDs to stay isolated across runs.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type CreateResult = {
  transfer_id:       string;
  transfer_number:   string;
  status:            string;
  idempotent_replay: boolean;
  movements:         Array<Record<string, unknown>> | null;
  items?:            Array<Record<string, unknown>>;
};

type ReceiveResult = {
  transfer_id:       string;
  transfer_number:   string;
  status:            string;
  idempotent_replay: boolean;
  movements:         Array<{
    movement_id?:        string;
    transfer_out_movement_id?: string;
    transfer_in_movement_id?:  string;
    product_id:          string;
    new_current_stock?:  number;
    [key: string]: unknown;
  }>;
};

type CancelResult = {
  transfer_id:   string;
  status:        string;
  cancel_reason: string;
};

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('internal-transfer RPCs — integration', () => {
  let adminToken:   string;
  let cashierToken: string;

  let fromSectionId: string; // MAIN_WAREHOUSE
  let toSectionId:   string; // PRODUCTION_KITCHEN

  let productAId: string; // premier produit track_inventory actif (S78)
  let productBId: string; // second produit track_inventory actif (S78)

  beforeAll(async () => {
    adminToken   = await loginAs('EMP000', '123456');
    cashierToken = await loginAs('EMP001', '567890');

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Resolve two distinct ACTIVE sections. S77: PRODUCTION_KITCHEN was
    // deactivated on the living dev DB (BO usage) and the transfer RPCs raise
    // section_not_found for inactive sections — prefer MAIN_WAREHOUSE as the
    // source, take any other active section as the destination.
    const { data: sections, error: secErr } = await admin
      .from('sections')
      .select('id, code')
      .eq('is_active', true)
      .is('deleted_at', null);
    if (secErr) throw secErr;
    if (!sections || sections.length < 2) {
      throw new Error(`Need >=2 active sections: got ${JSON.stringify(sections)}`);
    }
    fromSectionId = (sections.find(s => s.code === 'MAIN_WAREHOUSE') ?? sections[0]).id;
    toSectionId   = sections.find(s => s.id !== fromSectionId)!.id;

    // S78 (D-6) : BEV-AMER est soft-deleted sur la DB dev vivante, et
    // create_internal_transfer_v1 exige track_inventory=true + deleted_at NULL
    // (sinon P0002 product_not_found). Sélection filtrée + déterministe,
    // plus de dépendance à un sku seed.
    const { data: prods, error: prodsErr } = await admin.from('products')
      .select('id, sku')
      .eq('is_active', true)
      .is('deleted_at', null)
      .eq('track_inventory', true)
      .order('created_at', { ascending: true })
      .limit(2);
    if (prodsErr) throw prodsErr;
    if (!prods || prods.length < 2) {
      throw new Error('Need at least two active track_inventory products for transfer tests');
    }
    productAId = prods[0]!.id;
    productBId = prods[1]!.id;

    // S78 : les RPCs transfer vérifient section_stock du from-section
    // (insufficient_section_stock P0001) ET le stock global produit
    // (insufficient_stock P0002) — seed les deux couches à 500.
    for (const pid of [productAId, productBId]) {
      const { error: ssErr } = await admin.from('section_stock').upsert(
        { section_id: fromSectionId, product_id: pid, quantity: 500, unit: 'pcs' },
        { onConflict: 'section_id,product_id' },
      );
      if (ssErr) throw new Error(`section_stock seed: ${JSON.stringify(ssErr)}`);
    }
    const { error: stockErr } = await admin.from('products')
      .update({ current_stock: 500 })
      .in('id', [productAId, productBId]);
    if (stockErr) throw new Error(`current_stock seed: ${JSON.stringify(stockErr)}`);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 1 — Full happy cycle (pending → receive)
  // ───────────────────────────────────────────────────────────────────────────
  it('Scenario 1: create pending transfer with 2 items, then receive in full', async () => {
    const sb    = jwtClient(adminToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    // CREATE pending.
    const items = [
      { product_id: productAId, quantity: 5 },
      { product_id: productBId, quantity: 3 },
    ];
    const createRes = await sb.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   toSectionId,
      p_items:           items,
      p_notes:           'Scenario 1 — full happy cycle',
      p_send_directly:   false,
    });
    expect(createRes.error, createRes.error?.message).toBeNull();
    const created = createRes.data as CreateResult;
    expect(created.status).toBe('pending');
    expect(created.transfer_number).toMatch(/^TRF-\d{8}-\d{4}$/);
    expect(created.idempotent_replay).toBe(false);

    // Snapshot section_stock BEFORE receive for both products in both sections.
    type Row = { quantity: number };
    async function getQty(sectionId: string, productId: string): Promise<number> {
      const { data } = await admin.from('section_stock')
        .select('quantity')
        .eq('section_id', sectionId).eq('product_id', productId).maybeSingle();
      return data ? Number((data as Row).quantity) : 0;
    }

    const beforeFromA = await getQty(fromSectionId, productAId);
    const beforeFromB = await getQty(fromSectionId, productBId);
    const beforeToA   = await getQty(toSectionId,   productAId);
    const beforeToB   = await getQty(toSectionId,   productBId);

    // Fetch transfer_items to build received_items payload.
    const { data: tItems, error: tiErr } = await admin
      .from('transfer_items')
      .select('id, product_id, quantity_requested')
      .eq('transfer_id', created.transfer_id);
    expect(tiErr).toBeNull();
    expect(tItems).toHaveLength(2);
    const receivedItems = (tItems ?? []).map(ti => ({
      item_id:           ti.id,
      quantity_received: Number(ti.quantity_requested),
    }));

    // RECEIVE.
    const recvRes = await sb.rpc('receive_internal_transfer_v1', {
      p_transfer_id:    created.transfer_id,
      p_received_items: receivedItems,
    });
    expect(recvRes.error, recvRes.error?.message).toBeNull();
    const recv = recvRes.data as ReceiveResult;
    expect(recv.status).toBe('received');
    expect(recv.idempotent_replay).toBe(false);
    // Movements array has 2 entries — one per item (each entry encapsulates BOTH legs).
    // Note: the RPC currently appends out + in as separate JSONB elements (4 total per
    // the migration), so we assert >= 2 and verify the underlying stock_movements rows.
    expect(Array.isArray(recv.movements)).toBe(true);
    expect(recv.movements.length).toBeGreaterThanOrEqual(2);

    // Inspect stock_movements: 4 rows total (2 items × 2 legs).
    const { data: mvts, error: mvtErr } = await admin.from('stock_movements')
      .select('id, movement_type, quantity, product_id, from_section_id, to_section_id, metadata')
      .eq('metadata->>transfer_id', created.transfer_id);
    expect(mvtErr).toBeNull();
    expect(mvts).toHaveLength(4);

    const outRows = (mvts ?? []).filter(r => r.movement_type === 'transfer_out');
    const inRows  = (mvts ?? []).filter(r => r.movement_type === 'transfer_in');
    expect(outRows).toHaveLength(2);
    expect(inRows).toHaveLength(2);
    for (const r of outRows) expect(Number(r.quantity)).toBeLessThan(0);
    for (const r of inRows)  expect(Number(r.quantity)).toBeGreaterThan(0);

    // Verify section_stock deltas were applied (signed quantity already encodes direction).
    const afterFromA = await getQty(fromSectionId, productAId);
    const afterFromB = await getQty(fromSectionId, productBId);
    const afterToA   = await getQty(toSectionId,   productAId);
    const afterToB   = await getQty(toSectionId,   productBId);

    expect(afterFromA - beforeFromA).toBe(-5);
    expect(afterFromB - beforeFromB).toBe(-3);
    expect(afterToA   - beforeToA).toBe(5);
    expect(afterToB   - beforeToB).toBe(3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 2 — send_directly=true (immediate received)
  // ───────────────────────────────────────────────────────────────────────────
  it('Scenario 2: send_directly=true marks transfer received immediately + emits 2 movements', async () => {
    const sb    = jwtClient(adminToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    const createRes = await sb.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   toSectionId,
      p_items:           [{ product_id: productAId, quantity: 2 }],
      p_notes:           'Scenario 2 — send_directly',
      p_send_directly:   true,
    });
    expect(createRes.error, createRes.error?.message).toBeNull();
    const created = createRes.data as CreateResult;
    expect(created.status).toBe('received');
    expect(created.transfer_number).toMatch(/^TRF-\d{8}-\d{4}$/);

    // received_at must be non-null in DB (header).
    const { data: header } = await admin.from('internal_transfers')
      .select('status, received_at')
      .eq('id', created.transfer_id).single();
    expect(header!.status).toBe('received');
    expect(header!.received_at).not.toBeNull();

    // Exactly 2 movements emitted (transfer_out + transfer_in for the single item).
    const { data: mvts } = await admin.from('stock_movements')
      .select('movement_type, quantity')
      .eq('metadata->>transfer_id', created.transfer_id);
    expect(mvts).toHaveLength(2);
    const types = (mvts ?? []).map(r => r.movement_type).sort();
    expect(types).toEqual(['transfer_in', 'transfer_out']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 3 — Cancel before receive
  // ───────────────────────────────────────────────────────────────────────────
  it('Scenario 3: cancel a pending transfer with reason', async () => {
    const sb    = jwtClient(adminToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    const createRes = await sb.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   toSectionId,
      p_items:           [{ product_id: productAId, quantity: 1 }],
      p_notes:           'Scenario 3 — to be cancelled',
      p_send_directly:   false,
    });
    expect(createRes.error, createRes.error?.message).toBeNull();
    const created = createRes.data as CreateResult;
    expect(created.status).toBe('pending');

    const cancelRes = await sb.rpc('cancel_internal_transfer_v1', {
      p_transfer_id: created.transfer_id,
      p_reason:      'Test cancellation',
    });
    expect(cancelRes.error, cancelRes.error?.message).toBeNull();
    const cancel = cancelRes.data as CancelResult;
    expect(cancel.status).toBe('cancelled');
    expect(cancel.cancel_reason).toBe('Test cancellation');

    // DB confirms cancelled state + metadata.cancel_reason.
    const { data: header } = await admin.from('internal_transfers')
      .select('status, metadata')
      .eq('id', created.transfer_id).single();
    expect(header!.status).toBe('cancelled');
    const meta = (header!.metadata ?? {}) as Record<string, unknown>;
    expect(meta.cancel_reason).toBe('Test cancellation');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 4 — Idempotency on create
  // ───────────────────────────────────────────────────────────────────────────
  it('Scenario 4: same p_idempotency_key returns same transfer_id + replay=true', async () => {
    const sb    = jwtClient(adminToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    const key = crypto.randomUUID();

    const r1 = await sb.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   toSectionId,
      p_items:           [{ product_id: productAId, quantity: 4 }],
      p_send_directly:   false,
      p_idempotency_key: key,
    });
    expect(r1.error, r1.error?.message).toBeNull();
    const first = r1.data as CreateResult;
    expect(first.idempotent_replay).toBe(false);

    // Second call — same key, intentionally different items payload.
    const r2 = await sb.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   toSectionId,
      p_items:           [{ product_id: productAId, quantity: 99 }, { product_id: productBId, quantity: 1 }],
      p_send_directly:   false,
      p_idempotency_key: key,
    });
    expect(r2.error, r2.error?.message).toBeNull();
    const second = r2.data as CreateResult;
    expect(second.idempotent_replay).toBe(true);
    expect(second.transfer_id).toBe(first.transfer_id);

    // Only ONE row in internal_transfers with this key.
    const { count } = await admin.from('internal_transfers')
      .select('*', { count: 'exact', head: true })
      .eq('created_idempotency_key', key);
    expect(count).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 5 — Idempotency on receive
  // ───────────────────────────────────────────────────────────────────────────
  it('Scenario 5: same receive idempotency key does NOT double-emit movements', async () => {
    const sb    = jwtClient(adminToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    const createRes = await sb.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   toSectionId,
      p_items:           [{ product_id: productAId, quantity: 2 }],
      p_send_directly:   false,
    });
    expect(createRes.error, createRes.error?.message).toBeNull();
    const created = createRes.data as CreateResult;

    const { data: tItems } = await admin
      .from('transfer_items')
      .select('id, quantity_requested')
      .eq('transfer_id', created.transfer_id);
    const receivedItems = (tItems ?? []).map(ti => ({
      item_id:           ti.id,
      quantity_received: Number(ti.quantity_requested),
    }));

    const key = crypto.randomUUID();

    // First receive — emits 2 movements (1 item × 2 legs).
    const r1 = await sb.rpc('receive_internal_transfer_v1', {
      p_transfer_id:     created.transfer_id,
      p_received_items:  receivedItems,
      p_idempotency_key: key,
    });
    expect(r1.error, r1.error?.message).toBeNull();
    const recv1 = r1.data as ReceiveResult;
    expect(recv1.status).toBe('received');
    expect(recv1.idempotent_replay).toBe(false);

    const { count: countAfterFirst } = await admin.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('metadata->>transfer_id', created.transfer_id);
    expect(countAfterFirst).toBe(2);

    // Second receive — same key, must be a no-op replay.
    const r2 = await sb.rpc('receive_internal_transfer_v1', {
      p_transfer_id:     created.transfer_id,
      p_received_items:  receivedItems,
      p_idempotency_key: key,
    });
    expect(r2.error, r2.error?.message).toBeNull();
    const recv2 = r2.data as ReceiveResult;
    expect(recv2.idempotent_replay).toBe(true);

    const { count: countAfterSecond } = await admin.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('metadata->>transfer_id', created.transfer_id);
    expect(countAfterSecond).toBe(2);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 6 — RLS / permission denied for CASHIER
  // ───────────────────────────────────────────────────────────────────────────
  it('Scenario 6: CASHIER cannot create or receive transfers (forbidden)', async () => {
    const cashier = jwtClient(cashierToken);

    const createRes = await cashier.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   toSectionId,
      p_items:           [{ product_id: productAId, quantity: 1 }],
      p_send_directly:   false,
    });
    expect(createRes.error?.message ?? '').toMatch(/forbidden/);

    // Seed a pending transfer as ADMIN so receive has a target.
    const sb    = jwtClient(adminToken);
    const admin = createClient(SUPABASE_URL, SERVICE);

    const seedRes = await sb.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   toSectionId,
      p_items:           [{ product_id: productAId, quantity: 1 }],
      p_send_directly:   false,
    });
    expect(seedRes.error, seedRes.error?.message).toBeNull();
    const seeded = seedRes.data as CreateResult;

    const { data: tItems } = await admin
      .from('transfer_items')
      .select('id, quantity_requested')
      .eq('transfer_id', seeded.transfer_id);
    const receivedItems = (tItems ?? []).map(ti => ({
      item_id:           ti.id,
      quantity_received: Number(ti.quantity_requested),
    }));

    const recvRes = await cashier.rpc('receive_internal_transfer_v1', {
      p_transfer_id:    seeded.transfer_id,
      p_received_items: receivedItems,
    });
    expect(recvRes.error?.message ?? '').toMatch(/forbidden/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 7 — from_section_id = to_section_id rejected
  // ───────────────────────────────────────────────────────────────────────────
  it('Scenario 7: from_section_id == to_section_id → from_to_same_section', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('create_internal_transfer_v1', {
      p_from_section_id: fromSectionId,
      p_to_section_id:   fromSectionId,
      p_items:           [{ product_id: productAId, quantity: 1 }],
      p_send_directly:   false,
    });
    expect(error?.message ?? '').toMatch(/from_to_same_section/);
  });
});
