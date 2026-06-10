// supabase/tests/functions/loyalty-adjust.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function loginAs(employeeCode: string, pin: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE);
  await admin.from('user_profiles')
    .update({ failed_login_attempts: 0, locked_until: null })
    .eq('employee_code', employeeCode);
  const { data: profile } = await admin.from('user_profiles')
    .select('id').eq('employee_code', employeeCode).single();
  if (!profile) throw new Error(`No user_profile for ${employeeCode}`);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: profile.id, pin, device_type: 'pos' }),
  });
  const body = await res.json();
  if (!body.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.auth.access_token;
}

function jwtClient(token: string) {
  return createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY ?? '', {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('adjust_loyalty_points RPC', () => {
  let adminToken:   string;
  let managerToken: string;
  let customerId:   string;

  beforeAll(async () => {
    adminToken = await loginAs('EMP000', '123456');
    // MANAGER seed: EMP003 / PIN 111111 (seeded in seed.sql session-6 block).
    // MANAGER has loyalty.read but NOT loyalty.adjust — used to test the
    // forbidden guard in adjust_loyalty_points. Fail loudly if the seed is
    // missing so CI cannot silently skip the security assertion.
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: c } = await admin.from('customers')
      .insert({ name: 'Loyalty Test', phone: '+62810000099', customer_type: 'retail' })
      .select('id').single();
    if (!c) throw new Error('Failed to seed test customer');
    customerId = c.id;
    await admin.from('customers')
      .update({ loyalty_points: 1000, lifetime_points: 1000 })
      .eq('id', customerId);
  });

  it('admin: positive delta increases balance + lifetime, inserts ledger row', async () => {
    const sb = jwtClient(adminToken);
    const { data, error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: 250, p_reason: 'manual reward for VIP referral',
    });
    expect(error).toBeNull();
    expect(data?.[0].new_balance).toBe(1250);
    expect(data?.[0].new_lifetime).toBe(1250);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: tx } = await admin.from('loyalty_transactions')
      .select('points, points_balance_after, transaction_type, description')
      .eq('id', data![0].txn_id).single();
    expect(tx).toMatchObject({
      points: 250, points_balance_after: 1250, transaction_type: 'adjust',
      description: 'manual reward for VIP referral',
    });
  });

  it('admin: negative delta within balance — balance shrinks, lifetime unchanged', async () => {
    const sb = jwtClient(adminToken);
    const { data, error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: -100, p_reason: 'corrective: duplicate earn',
    });
    expect(error).toBeNull();
    expect(data?.[0].new_balance).toBe(1150);
    expect(data?.[0].new_lifetime).toBe(1250);
  });

  it('admin: negative delta exceeding balance raises insufficient_balance', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: -99999, p_reason: 'should fail because balance too low',
    });
    expect(error?.message).toMatch(/insufficient_balance/);
  });

  it('manager: forbidden (no loyalty.adjust)', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: 50, p_reason: 'manager attempt',
    });
    expect(error?.message).toMatch(/forbidden/);
  });

  it('admin: zero delta -> invalid_input', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: 0, p_reason: 'zero delta should be rejected',
    });
    expect(error?.message).toMatch(/invalid_input/);
  });

  it('admin: short reason -> invalid_input', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: 10, p_reason: 'hi',
    });
    expect(error?.message).toMatch(/invalid_input/);
  });

  it('admin: NULL p_customer_id -> invalid_input', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      // Runtime-NULL handling — generated types accept null on this param.
      p_customer_id: null as unknown as string, p_delta: 10, p_reason: 'null customer should be rejected',
    });
    expect(error?.message).toMatch(/invalid_input/);
  });

  it('admin: soft-deleted customer -> customer_deleted', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: c } = await admin.from('customers')
      .insert({ name: 'Soft Delete Me', phone: '+62810000098', customer_type: 'retail' })
      .select('id').single();
    await admin.from('customers').update({ deleted_at: new Date().toISOString() }).eq('id', c!.id);

    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: c!.id, p_delta: 50, p_reason: 'should fail on tombstoned row',
    });
    expect(error?.message).toMatch(/customer_deleted/);
  });

  it('admin: nonexistent UUID -> customer_deleted', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: '00000000-0000-0000-0000-000000000000', p_delta: 10,
      p_reason: 'should fail on missing row',
    });
    expect(error?.message).toMatch(/customer_deleted/);
  });

  it('admin: |delta| > 1_000_000 -> invalid_input (overflow guard)', async () => {
    const sb = jwtClient(adminToken);
    for (const delta of [1_000_001, -1_000_001, 2_000_000_000]) {
      const { error } = await sb.rpc('adjust_loyalty_points', {
        p_customer_id: customerId, p_delta: delta, p_reason: 'overflow attempt',
      });
      expect(error?.message, `delta=${delta}`).toMatch(/invalid_input/);
    }
  });

  it('admin: reason > 500 chars -> invalid_input', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: 10, p_reason: 'x'.repeat(501),
    });
    expect(error?.message).toMatch(/invalid_input/);
  });

  it('admin: whitespace-only reason -> invalid_input', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: 10, p_reason: '          ',
    });
    expect(error?.message).toMatch(/invalid_input/);
  });

  it('admin: customer row + ledger row stay consistent after RPC', async () => {
    // Use a fresh customer so we control the seed values.
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: c } = await admin.from('customers')
      .insert({ name: 'Consistency Check', phone: '+62810000077', customer_type: 'retail' })
      .select('id').single();
    await admin.from('customers').update({ loyalty_points: 500, lifetime_points: 500 }).eq('id', c!.id);

    const sb = jwtClient(adminToken);
    const { data, error } = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: c!.id, p_delta: -200, p_reason: 'redeem-like correction',
    });
    expect(error).toBeNull();

    // Customer row reflects new balance, lifetime is preserved on negative delta.
    const { data: row } = await admin.from('customers')
      .select('loyalty_points, lifetime_points').eq('id', c!.id).single();
    expect(row?.loyalty_points).toBe(300);
    expect(row?.lifetime_points).toBe(500);

    // Ledger row carries the actor's user_profiles.id.
    const { data: profile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP000').single();
    const { data: tx } = await admin.from('loyalty_transactions')
      .select('created_by, points, points_balance_after').eq('id', data![0].txn_id).single();
    expect(tx?.created_by).toBe(profile?.id);
    expect(tx?.points).toBe(-200);
    expect(tx?.points_balance_after).toBe(300);
  });
});

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('get_loyalty_tier helper — boundary table', () => {
  // Mirrors packages/domain/src/loyalty/tiers.ts. A drift here means the
  // SQL helper and the TS helper disagree on a tier boundary, which would
  // cause server projections and client rendering to diverge.
  const CASES: Array<[number, 'bronze' | 'silver' | 'gold' | 'platinum']> = [
    [-1,    'bronze'],
    [0,     'bronze'],
    [499,   'bronze'],
    [500,   'silver'],
    [1999,  'silver'],
    [2000,  'gold'],
    [4999,  'gold'],
    [5000,  'platinum'],
    [50000, 'platinum'],
  ];

  it.each(CASES)('lifetime=%i -> %s', async (lifetime, expected) => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data, error } = await admin.rpc('get_loyalty_tier', { p_lifetime_points: lifetime });
    expect(error).toBeNull();
    expect(data).toBe(expected);
  });
});
