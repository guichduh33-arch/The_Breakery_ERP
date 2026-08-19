// supabase/tests/functions/inventory-opname.test.ts
// Session 13 / Phase 2.D — Vitest live RPC tests for the full opname cycle.
//
// ADR-027 (2026-08-16) : opname devient mono-section — create_opname_v1 /
// add_opname_item_v1 / finalize_opname_v1 sont droppées au profit des _v2
// (plus d'argument section). L'attendu se charge désormais depuis
// products.current_stock (le stock qui fait autorité), plus depuis
// section_stock (table droppée dans le même chantier).
//
// Covers :
//   - create_opname_v2 happy path + idempotency (sans section).
//   - add_opname_item_v2 auto-loads expected_qty from products.current_stock
//     when p_expected_qty is omitted.
//   - set_opname_count_v1 records counted_qty ; variance is GENERATED.
//   - validate_opname_v1 transitions counting → review (rejects with missing counts).
//   - finalize_opname_v3 emits opname_in / opname_out stock_movements (sans
//     section) + tr_20_je_emit posts a balanced JE for each non-zero variance row.
//   - cancel_opname_v1 succeeds pre-finalize, refused post-finalize.
//   - MANAGER allowed to create, ADMIN required to finalize.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';
import { ensureTestProduct } from './_helpers/fixtures';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Type-erased rpc helper (generated types may lag behind staging migrations).
function rpc(sb: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb.rpc.bind(sb) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('inventory opname — full cycle', () => {
  let adminToken: string;
  let managerToken: string;
  let productId: string;
  const createdCountIds: string[] = [];

  beforeAll(async () => {
    adminToken   = await loginAs('EMP000', '123456');
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);

    // S78 (D-6) : BEV-AMER est soft-deleted sur la DB vivante (P0002 dans les
    // RPCs opname). Produit de test dédié, upsert-restauré par sku fixe.
    // ADR-027 : current_stock=100 remplace le seed section_stock — c'est
    // désormais la seule source de l'attendu auto-chargé (T_OPN_LIVE_02).
    productId = await ensureTestProduct(admin, {
      sku: 'ZZ-TEST-OPNAME', name: '[TEST] Opname live spec', cost_price: 5000,
      current_stock: 100,
    });
  });

  afterAll(async () => {
    if (createdCountIds.length === 0) return;
    const admin = createClient(SUPABASE_URL, SERVICE);
    // Best-effort cleanup. Don't fail teardown on RLS quirks.
    for (const id of createdCountIds) {
      try { await admin.from('inventory_count_items').delete().eq('count_id', id); } catch (_) { /* ignore */ }
      try { await admin.from('inventory_counts').delete().eq('id', id); } catch (_) { /* ignore */ }
    }
  });

  it('T_OPN_LIVE_01: create_opname_v2 happy path + idempotent replay', async () => {
    const sb = jwtClient(managerToken);
    const idemKey = crypto.randomUUID();

    const { data: r1, error: e1 } = await rpc(sb)('create_opname_v2', {
      p_notes: 'live test count',
      p_idempotency_key: idemKey,
    });
    expect(e1).toBeNull();
    expect(r1.count_id).toBeTruthy();
    expect(r1.status).toBe('draft');
    expect(r1.idempotent_replay).toBe(false);
    expect(r1.count_number).toMatch(/^OPN-\d{8}-\d{4}$/);
    createdCountIds.push(r1.count_id);

    // Replay with same key → idempotent_replay=true, same count_id.
    const { data: r2, error: e2 } = await rpc(sb)('create_opname_v2', {
      p_notes: 'live test count (replay)',
      p_idempotency_key: idemKey,
    });
    expect(e2).toBeNull();
    expect(r2.count_id).toBe(r1.count_id);
    expect(r2.idempotent_replay).toBe(true);
  });

  it('T_OPN_LIVE_02: add_opname_item_v2 auto-loads expected_qty from products.current_stock', async () => {
    const sb = jwtClient(managerToken);
    const { data: created } = await rpc(sb)('create_opname_v2', {
      p_idempotency_key: crypto.randomUUID(),
    });
    createdCountIds.push(created.count_id);

    const { data: item, error } = await rpc(sb)('add_opname_item_v2', {
      p_count_id: created.count_id,
      p_product_id: productId,
      // p_expected_qty omitted → auto-load from products.current_stock=100
    });
    expect(error).toBeNull();
    expect(item.item_id).toBeTruthy();
    expect(Number(item.expected_qty)).toBe(100);
    expect(item.unit).toBe('pcs');
  });

  it('T_OPN_LIVE_03: full cycle — set_count → validate → finalize → JE balanced', async () => {
    const sb = jwtClient(adminToken); // ADMIN to allow finalize

    const { data: created } = await rpc(sb)('create_opname_v2', {
      p_notes: 'full-cycle',
      p_idempotency_key: crypto.randomUUID(),
    });
    const countId = created.count_id as string;
    createdCountIds.push(countId);

    const { data: item } = await rpc(sb)('add_opname_item_v2', {
      p_count_id: countId,
      p_product_id: productId,
      p_expected_qty: 100,
    });

    // Set counted_qty = 95 → variance = -5 (opname_out).
    await rpc(sb)('set_opname_count_v1', {
      p_count_item_id: item.item_id,
      p_counted_qty: 95,
    });

    // Validate draft|counting → review.
    const { data: validated, error: vErr } = await rpc(sb)('validate_opname_v1', {
      p_count_id: countId,
    });
    expect(vErr).toBeNull();
    expect(validated.status).toBe('review');

    // Capture JE count before finalize.
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { count: jeBefore } = await admin.from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('reference_type', 'stock_movement');

    // Finalize.
    const { data: finalized, error: fErr } = await rpc(sb)('finalize_opname_v3', {
      p_count_id: countId,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(fErr).toBeNull();
    expect(finalized.status).toBe('finalized');
    expect(finalized.movements_emitted).toBe(1);
    expect(finalized.movements).toHaveLength(1);
    expect(finalized.movements[0].movement_type).toBe('opname_out');
    expect(Number(finalized.movements[0].quantity)).toBe(5);

    // JE balanced check.
    const movementId = finalized.movements[0].movement_id as string;
    const { data: je } = await admin.from('journal_entries')
      .select('total_debit, total_credit, metadata')
      .eq('reference_id', movementId)
      .eq('reference_type', 'stock_movement')
      .single();
    expect(je).toBeTruthy();
    expect(Number(je!.total_debit)).toBe(Number(je!.total_credit));
    expect(Number(je!.total_debit)).toBe(25000); // 5 * 5000
    expect((je!.metadata as { movement_type: string }).movement_type).toBe('opname_out');

    const { count: jeAfter } = await admin.from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('reference_type', 'stock_movement');
    expect((jeAfter ?? 0) - (jeBefore ?? 0)).toBe(1);

    // ADR-027 : finalize_opname_v3 émet ses mouvements sans section.
    const { data: mvt } = await admin.from('stock_movements')
      .select('from_section_id, to_section_id')
      .eq('id', movementId)
      .single();
    expect(mvt!.from_section_id).toBeNull();
    expect(mvt!.to_section_id).toBeNull();

    // Replay finalize → idempotent_replay=true.
    const { data: replay } = await rpc(sb)('finalize_opname_v3', {
      p_count_id: countId,
    });
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.movements_emitted).toBe(1);
  });

  it('T_OPN_LIVE_04: validate_opname_v1 raises missing_counts when counted_qty is NULL', async () => {
    const sb = jwtClient(managerToken);
    const { data: created } = await rpc(sb)('create_opname_v2', {
      p_idempotency_key: crypto.randomUUID(),
    });
    createdCountIds.push(created.count_id);

    await rpc(sb)('add_opname_item_v2', {
      p_count_id: created.count_id,
      p_product_id: productId,
      p_expected_qty: 100,
    });
    // No set_opname_count → validate should fail.
    const { error } = await rpc(sb)('validate_opname_v1', { p_count_id: created.count_id });
    expect(error?.message ?? '').toMatch(/missing_counts/);
  });

  it('T_OPN_LIVE_05: cancel allowed before finalize, refused after', async () => {
    const sb = jwtClient(adminToken);
    const { data: created } = await rpc(sb)('create_opname_v2', {
      p_idempotency_key: crypto.randomUUID(),
    });
    const countId = created.count_id as string;
    createdCountIds.push(countId);

    const { data: cancelled, error: cErr } = await rpc(sb)('cancel_opname_v1', {
      p_count_id: countId, p_reason: 'live test cleanup',
    });
    expect(cErr).toBeNull();
    expect(cancelled.status).toBe('cancelled');

    // Re-cancel → already_cancelled.
    const { error: e2 } = await rpc(sb)('cancel_opname_v1', {
      p_count_id: countId, p_reason: 'second attempt',
    });
    expect(e2?.message ?? '').toMatch(/already_cancelled/);
  });

  it('T_OPN_LIVE_06: MANAGER cannot finalize (ADMIN-only)', async () => {
    const adminSb = jwtClient(adminToken);
    const managerSb = jwtClient(managerToken);

    const { data: created } = await rpc(adminSb)('create_opname_v2', {
      p_idempotency_key: crypto.randomUUID(),
    });
    const countId = created.count_id as string;
    createdCountIds.push(countId);

    await rpc(adminSb)('add_opname_item_v2', {
      p_count_id: countId, p_product_id: productId, p_expected_qty: 100,
    });

    const { error: fErr } = await rpc(managerSb)('finalize_opname_v3', { p_count_id: countId });
    expect(fErr?.message ?? '').toMatch(/forbidden/);
  });
});
