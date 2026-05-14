// supabase/tests/functions/stock-reservations.test.ts
// Session 13 / Phase 3.C — Live integration tests for stock_reservations RPCs.
//
// Covers:
//   - reservation_hold_v1 happy path + reduces available
//   - reservation_release_v1 restores available
//   - reservation_consume_v1 transitions held -> consumed
//   - Idempotent replay (same idempotency_key returns same reservation_id)
//   - insufficient_available_stock raised when oversubscribed
//   - release_expired_reservations() flips expired rows

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

describe('stock_reservations RPCs — integration', () => {
  let cashierToken: string;
  let productId: string;
  const futureIso = () => new Date(Date.now() + 10 * 60_000).toISOString();

  beforeAll(async () => {
    cashierToken = await loginAs('EMP002', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    productId = p!.id;
    // Bump stock so we don't conflict with other suites.
    await admin.from('products').update({ current_stock: 100 }).eq('id', productId);
  });

  it('hold reduces available_quantity', async () => {
    const sb = jwtClient(cashierToken);

    const { data: before } = await sb.from('v_product_available_stock')
      .select('available_quantity').eq('product_id', productId).single();
    const initialAvail = Number(before!.available_quantity);

    const { data: hold, error } = await sb.rpc('reservation_hold_v1', {
      p_product_id: productId,
      p_quantity: 5,
      p_holder_type: 'cart',
      p_expires_at: futureIso(),
    });
    expect(error).toBeNull();
    expect(hold).toMatchObject({ idempotent_replay: false });
    expect(hold).toHaveProperty('reservation_id');

    const { data: after } = await sb.from('v_product_available_stock')
      .select('available_quantity').eq('product_id', productId).single();
    expect(Number(after!.available_quantity)).toBe(initialAvail - 5);

    // Cleanup.
    await sb.rpc('reservation_release_v1', {
      p_reservation_id: (hold as { reservation_id: string }).reservation_id,
      p_reason: 'test cleanup',
    });
  });

  it('release restores available_quantity', async () => {
    const sb = jwtClient(cashierToken);

    const { data: hold } = await sb.rpc('reservation_hold_v1', {
      p_product_id: productId,
      p_quantity: 3,
      p_holder_type: 'cart',
      p_expires_at: futureIso(),
    });
    const resId = (hold as { reservation_id: string }).reservation_id;

    const { data: before } = await sb.from('v_product_available_stock')
      .select('available_quantity').eq('product_id', productId).single();

    const { data: release, error } = await sb.rpc('reservation_release_v1', {
      p_reservation_id: resId,
      p_reason: 'cart abandoned',
    });
    expect(error).toBeNull();
    expect(release).toMatchObject({ status: 'released', replay: false });

    const { data: after } = await sb.from('v_product_available_stock')
      .select('available_quantity').eq('product_id', productId).single();
    expect(Number(after!.available_quantity)).toBe(Number(before!.available_quantity) + 3);
  });

  it('consume transitions held -> consumed', async () => {
    const sb = jwtClient(cashierToken);
    const { data: hold } = await sb.rpc('reservation_hold_v1', {
      p_product_id: productId,
      p_quantity: 2,
      p_holder_type: 'tablet',
      p_expires_at: futureIso(),
    });
    const resId = (hold as { reservation_id: string }).reservation_id;

    const { data: consumed, error } = await sb.rpc('reservation_consume_v1', {
      p_reservation_id: resId,
    });
    expect(error).toBeNull();
    expect(consumed).toMatchObject({ status: 'consumed', replay: false });
  });

  it('idempotent replay returns same reservation_id', async () => {
    const sb = jwtClient(cashierToken);
    const key = crypto.randomUUID();
    const args = {
      p_product_id: productId,
      p_quantity: 4,
      p_holder_type: 'cart',
      p_expires_at: futureIso(),
      p_idempotency_key: key,
    };
    const { data: first } = await sb.rpc('reservation_hold_v1', args);
    const { data: second } = await sb.rpc('reservation_hold_v1', args);
    expect((first as { reservation_id: string }).reservation_id)
      .toBe((second as { reservation_id: string }).reservation_id);
    expect(second).toMatchObject({ idempotent_replay: true });
    // Cleanup.
    await sb.rpc('reservation_release_v1', {
      p_reservation_id: (first as { reservation_id: string }).reservation_id,
    });
  });

  it('rejects holds exceeding available stock', async () => {
    const sb = jwtClient(cashierToken);
    const { data: stock } = await sb.from('v_product_available_stock')
      .select('available_quantity').eq('product_id', productId).single();
    const { error } = await sb.rpc('reservation_hold_v1', {
      p_product_id: productId,
      p_quantity: Number(stock!.available_quantity) + 9999,
      p_holder_type: 'cart',
      p_expires_at: futureIso(),
    });
    expect(error?.message).toMatch(/insufficient_available_stock/);
  });

  it('release_expired_reservations sweeps past-due holds', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    // Insert an already-expired reservation via service role (bypasses
    // expires_at > now() RPC validation).
    const { data: row } = await admin.from('stock_reservations')
      .insert({
        product_id: productId,
        quantity: 1,
        holder_type: 'cart',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .select('id').single();
    expect(row).toBeTruthy();

    const { data: swept, error } = await admin.rpc('release_expired_reservations');
    expect(error).toBeNull();
    expect(Number(swept)).toBeGreaterThanOrEqual(1);

    const { data: after } = await admin.from('stock_reservations')
      .select('status, released_reason').eq('id', row!.id).single();
    expect(after?.status).toBe('released');
    expect(after?.released_reason).toBe('expired');
  });
});
