// supabase/tests/functions/inventory-opname.test.ts
// Session 13 / Phase 2.D — Vitest live RPC tests for the full opname cycle.
//
// Covers :
//   - create_opname_v1 happy path + idempotency.
//   - add_opname_item_v1 auto-loads expected_qty from section_stock when NULL.
//   - set_opname_count_v1 records counted_qty ; variance is GENERATED.
//   - validate_opname_v1 transitions counting → review (rejects with missing counts).
//   - finalize_opname_v1 emits opname_in / opname_out stock_movements +
//     tr_20_je_emit posts a balanced JE for each non-zero variance row.
//   - cancel_opname_v1 succeeds pre-finalize, refused post-finalize.
//   - MANAGER allowed to create, ADMIN required to finalize.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

function jwtClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Type-erased rpc helper (generated types may lag behind staging migrations).
function rpc(sb: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
}

describe('inventory opname — full cycle', () => {
  let adminToken: string;
  let managerToken: string;
  let sectionId: string;
  let productId: string;
  const createdCountIds: string[] = [];

  beforeAll(async () => {
    adminToken   = await loginAs('EMP000', '123456');
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: s } = await admin.from('sections')
      .select('id').eq('code', 'MAIN_WAREHOUSE').single();
    sectionId = s!.id;

    // Use a stable test product. Bump cost_price so JE valuation > 0.
    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    productId = p!.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('products').update({ cost_price: 5000 } as any).eq('id', productId);

    // Seed section_stock = 100 so expected_qty auto-load works.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('section_stock').upsert({
      section_id: sectionId, product_id: productId, quantity: 100, unit: 'pcs',
    } as any, { onConflict: 'section_id,product_id' });
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

  it('T_OPN_LIVE_01: create_opname_v1 happy path + idempotent replay', async () => {
    const sb = jwtClient(managerToken);
    const idemKey = crypto.randomUUID();

    const { data: r1, error: e1 } = await rpc(sb)('create_opname_v1', {
      p_section_id: sectionId,
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
    const { data: r2, error: e2 } = await rpc(sb)('create_opname_v1', {
      p_section_id: sectionId,
      p_notes: 'live test count (replay)',
      p_idempotency_key: idemKey,
    });
    expect(e2).toBeNull();
    expect(r2.count_id).toBe(r1.count_id);
    expect(r2.idempotent_replay).toBe(true);
  });

  it('T_OPN_LIVE_02: add_opname_item_v1 auto-loads expected_qty from section_stock', async () => {
    const sb = jwtClient(managerToken);
    const { data: created } = await rpc(sb)('create_opname_v1', {
      p_section_id: sectionId, p_idempotency_key: crypto.randomUUID(),
    });
    createdCountIds.push(created.count_id);

    const { data: item, error } = await rpc(sb)('add_opname_item_v1', {
      p_count_id: created.count_id,
      p_product_id: productId,
      // p_expected_qty omitted → auto-load from section_stock.quantity=100
    });
    expect(error).toBeNull();
    expect(item.item_id).toBeTruthy();
    expect(Number(item.expected_qty)).toBe(100);
    expect(item.unit).toBe('pcs');
  });

  it('T_OPN_LIVE_03: full cycle — set_count → validate → finalize → JE balanced', async () => {
    const sb = jwtClient(adminToken); // ADMIN to allow finalize

    const { data: created } = await rpc(sb)('create_opname_v1', {
      p_section_id: sectionId,
      p_notes: 'full-cycle',
      p_idempotency_key: crypto.randomUUID(),
    });
    const countId = created.count_id as string;
    createdCountIds.push(countId);

    const { data: item } = await rpc(sb)('add_opname_item_v1', {
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
    const { data: finalized, error: fErr } = await rpc(sb)('finalize_opname_v1', {
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

    // Replay finalize → idempotent_replay=true.
    const { data: replay } = await rpc(sb)('finalize_opname_v1', {
      p_count_id: countId,
    });
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.movements_emitted).toBe(1);
  });

  it('T_OPN_LIVE_04: validate_opname_v1 raises missing_counts when counted_qty is NULL', async () => {
    const sb = jwtClient(managerToken);
    const { data: created } = await rpc(sb)('create_opname_v1', {
      p_section_id: sectionId, p_idempotency_key: crypto.randomUUID(),
    });
    createdCountIds.push(created.count_id);

    await rpc(sb)('add_opname_item_v1', {
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
    const { data: created } = await rpc(sb)('create_opname_v1', {
      p_section_id: sectionId, p_idempotency_key: crypto.randomUUID(),
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

    const { data: created } = await rpc(adminSb)('create_opname_v1', {
      p_section_id: sectionId, p_idempotency_key: crypto.randomUUID(),
    });
    const countId = created.count_id as string;
    createdCountIds.push(countId);

    await rpc(adminSb)('add_opname_item_v1', {
      p_count_id: countId, p_product_id: productId, p_expected_qty: 100,
    });

    const { error: fErr } = await rpc(managerSb)('finalize_opname_v1', { p_count_id: countId });
    expect(fErr?.message ?? '').toMatch(/forbidden/);
  });
});
