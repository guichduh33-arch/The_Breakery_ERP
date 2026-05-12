// supabase/tests/functions/adjust-stock.test.ts
// Session 12 — Live integration tests for adjust_stock_v1 RPC.
// Pattern mirrors loyalty-adjust.test.ts: PIN-login → JWT-bearing client → rpc().
//
// Coverage:
//   - Happy path (ADMIN sets new_qty, signed delta movement recorded)
//   - Idempotency replay (same key returns idempotent_replay=true, single row)
//   - Permission denied (MANAGER cannot adjust)
//   - Negative qty rejected
//   - Audit_log row created with actor_profile_id
//   - Noop when new_qty == current_stock (no movement inserted)

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

describe('adjust_stock_v1 RPC — integration', () => {
  let adminToken:   string;
  let managerToken: string;
  let productId:    string;
  let adminProfileId: string;

  beforeAll(async () => {
    adminToken   = await loginAs('EMP000', '123456');
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Seed product profile id for audit assertions
    const { data: prof } = await admin.from('user_profiles').select('id')
      .eq('employee_code', 'EMP000').single();
    adminProfileId = prof!.id;

    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    productId = p!.id;
  });

  beforeEach(async () => {
    // Reset product stock to a deterministic baseline before each test.
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('products').update({ current_stock: 50 }).eq('id', productId);
  });

  it('admin happy path: sets new_qty, records signed delta movement', async () => {
    const sb = jwtClient(adminToken);
    const { data, error } = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: 75,
      p_reason: 'Initial recount after physical audit',
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const result = data as { new_current_stock: number; movement_id: string; idempotent_replay: boolean };
    expect(Number(result.new_current_stock)).toBe(75);
    expect(result.movement_id).toBeTruthy();
    expect(result.idempotent_replay).toBe(false);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: mvt } = await admin.from('stock_movements')
      .select('quantity, movement_type, reason, created_by')
      .eq('id', result.movement_id).single();
    expect(Number(mvt!.quantity)).toBe(25);
    expect(mvt!.movement_type).toBe('adjustment');
    expect(mvt!.reason).toBe('Initial recount after physical audit');
    expect(mvt!.created_by).toBe(adminProfileId);
  });

  it('admin: audit_log row inserted with actor_profile_id + payload', async () => {
    const sb = jwtClient(adminToken);
    const { data, error } = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: 60,
      p_reason: 'Audit trail verification',
    });
    expect(error).toBeNull();
    const result = data as { movement_id: string };

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: audit } = await admin.from('audit_log')
      .select('action, subject_table, actor_profile_id, payload')
      .eq('subject_id', result.movement_id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit?.action).toBe('stock.movement');
    expect(audit?.subject_table).toBe('stock_movements');
    expect(audit?.actor_profile_id).toBe(adminProfileId);
    const payload = audit?.payload as { movement_type: string; quantity: string; reason: string };
    expect(payload.movement_type).toBe('adjustment');
    expect(payload.reason).toBe('Audit trail verification');
  });

  it('idempotency: same key on retry returns idempotent_replay=true, single row', async () => {
    const sb = jwtClient(adminToken);
    const key = '00000000-0000-0000-0000-00000000abcd';

    const r1 = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: 80,
      p_reason: 'Idempotency first call',
      p_idempotency_key: key,
    });
    expect(r1.error).toBeNull();
    const data1 = r1.data as { movement_id: string; idempotent_replay: boolean };
    expect(data1.idempotent_replay).toBe(false);

    const r2 = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: 80,
      p_reason: 'Idempotency retry',
      p_idempotency_key: key,
    });
    expect(r2.error).toBeNull();
    const data2 = r2.data as { movement_id: string; idempotent_replay: boolean };
    expect(data2.idempotent_replay).toBe(true);
    expect(data2.movement_id).toBe(data1.movement_id);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { count } = await admin.from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(1);

    // Cleanup so subsequent test runs are stable.
    await admin.from('stock_movements').delete().eq('idempotency_key', key);
  });

  it('manager: forbidden (no inventory.adjust)', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: 100,
      p_reason: 'Manager attempting adjust',
    });
    expect(error?.message ?? '').toMatch(/forbidden/);
  });

  it('admin: p_new_qty < 0 -> negative_qty_not_allowed', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: -5,
      p_reason: 'Negative target should be rejected',
    });
    expect(error?.message ?? '').toMatch(/negative_qty_not_allowed/);
  });

  it('admin: no-op when new_qty == current_stock (no movement, noop=true)', async () => {
    const sb = jwtClient(adminToken);
    const { data, error } = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: 50,    // baseline set in beforeEach
      p_reason: 'Same value — noop expected',
    });
    expect(error).toBeNull();
    const result = data as { movement_id: string | null; noop?: boolean; new_current_stock: number };
    expect(result.noop).toBe(true);
    expect(result.movement_id).toBeNull();
    expect(Number(result.new_current_stock)).toBe(50);
  });

  it('admin: short reason (<3 chars) is rejected upstream by record_stock_movement_v1', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_stock_v1', {
      p_product_id: productId,
      p_new_qty: 70,
      p_reason: 'hi',
    });
    expect(error?.message ?? '').toMatch(/reason_required/);
  });
});
