// supabase/tests/functions/accounting-sale-je.test.ts
//
// Session 13 / Phase 1.A — Vitest live RPC tests for sale JE refactor.
// Covers (per DoD INDEX:248) :
//   - Create order → 1 JE balanced
//   - Re-trigger → no doublon
//   - Closed fiscal_period → fail period_locked (P0004)
//
// Pattern mirrors supabase/tests/functions/receive-stock.test.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('accounting — sale JE refactor (Phase 1.A 10-001)', () => {
  let managerToken: string;
  let productId:    string;
  let sessionId:    string;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    productId = p!.id;
    // Ensure plenty of stock.
    await admin.from('products').update({ current_stock: 1000 }).eq('id', productId);

    // Resolve an open session for the manager (or open one).
    const { data: prof } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP003').single();
    const { data: existingSession } = await admin.from('pos_sessions')
      .select('id').eq('opened_by', prof!.id).eq('status', 'open').limit(1).single();
    if (existingSession?.id) {
      sessionId = existingSession.id;
    } else {
      const { data: newSession } = await admin.from('pos_sessions')
        .insert({ opened_by: prof!.id, status: 'open', opening_cash: 0 })
        .select('id').single();
      sessionId = newSession!.id;
    }
  });

  afterAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    for (const id of createdOrderIds) {
      await admin.from('orders').delete().eq('id', id);
    }
  });

  it('complete_order_with_payment_v9 → 1 balanced JE (mapping resolved)', async () => {
    const sb = jwtClient(managerToken);
    const idempKey = crypto.randomUUID();

    const { data, error } = await sb.rpc('complete_order_with_payment_v9', {
      p_session_id:      sessionId,
      p_order_type:      'dine_in',
      p_items:           [{ product_id: productId, quantity: 1, unit_price: 30000 }],
      p_payment:         { method: 'cash', amount: 30000, cash_received: 30000, change_given: 0 },
      p_idempotency_key: idempKey,
    });
    expect(error).toBeNull();
    const orderId = (data as { order_id: string }).order_id;
    createdOrderIds.push(orderId);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: jeList } = await admin.from('journal_entries')
      .select('id, total_debit, total_credit, reference_type')
      .eq('reference_type', 'sale')
      .eq('reference_id', orderId);

    expect(jeList?.length).toBe(1);
    const je = jeList![0];
    expect(Number(je.total_debit)).toBeGreaterThan(0);
    expect(Number(je.total_debit)).toBe(Number(je.total_credit));
  });

  it('re-firing UPDATE does NOT create a second JE (idempotency)', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const orderId = createdOrderIds[createdOrderIds.length - 1];

    // Re-fire by no-op UPDATE (status stays paid).
    await admin.from('orders').update({ updated_at: new Date().toISOString() }).eq('id', orderId);

    const { data: jeList } = await admin.from('journal_entries')
      .select('id').eq('reference_type', 'sale').eq('reference_id', orderId);

    expect(jeList?.length).toBe(1);
  });

  it('closed fiscal period blocks JE creation (period_locked P0004)', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    // Create a locked period covering today's date — temporarily.
    const today = new Date().toISOString().slice(0, 10);
    const fixtureNote = `Vitest sale-je lock fixture ${Date.now()}`;
    const { data: fp } = await admin.from('fiscal_periods')
      .insert({
        period_start: today,
        period_end:   today,
        status:       'locked',
        notes:        fixtureNote,
      })
      .select('id').single();

    try {
      const sb = jwtClient(managerToken);
      const { error } = await sb.rpc('complete_order_with_payment_v9', {
        p_session_id:      sessionId,
        p_order_type:      'dine_in',
        p_items:           [{ product_id: productId, quantity: 1, unit_price: 30000 }],
        p_payment:         { method: 'cash', amount: 30000, cash_received: 30000, change_given: 0 },
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/period_locked|P0004/);
    } finally {
      if (fp?.id) await admin.from('fiscal_periods').delete().eq('id', fp.id);
    }
  });
});
