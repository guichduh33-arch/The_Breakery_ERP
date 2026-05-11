// supabase/tests/functions/loyalty-rls.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON         = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function loginAs(employeeCode: string, pin: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE);
  await admin.from('user_profiles')
    .update({ failed_login_attempts: 0, locked_until: null })
    .eq('employee_code', employeeCode);
  const { data: profile } = await admin.from('user_profiles')
    .select('id').eq('employee_code', employeeCode).single();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: profile!.id, pin, device_type: 'pos' }),
  });
  const body = await res.json();
  return body.auth.access_token;
}

describe('customers RLS — column GRANTs', () => {
  let token: string;
  let customerId: string;

  beforeAll(async () => {
    // Admin seed: EMP000 / PIN 123456 (6-digit, matches auth-verify-pin regex + seed.sql).
    token = await loginAs('EMP000', '123456');
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data } = await admin.from('customers')
      .insert({ name: 'RLS Test', phone: '+62810000097', customer_type: 'retail' })
      .select('id').single();
    customerId = data!.id;
    await admin.from('customers').update({ loyalty_points: 100, lifetime_points: 100 }).eq('id', customerId);
  });

  it('authenticated CAN update name/phone/email', async () => {
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { error } = await sb.from('customers')
      .update({ name: 'RLS Test Renamed', phone: '+62810000196', email: 'rls@test.local' })
      .eq('id', customerId);
    expect(error).toBeNull();
  });

  it('authenticated CANNOT update loyalty_points directly (column GRANT)', async () => {
    // Hardening migration 20260515000001 replaced the table-level GRANT with
    // explicit per-column GRANTs that omit loyalty_points. Postgres should now
    // refuse the UPDATE with `permission denied for table customers`.
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { error } = await sb.from('customers')
      .update({ loyalty_points: 9999 })
      .eq('id', customerId);

    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/permission denied|insufficient|access/);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: row } = await admin.from('customers').select('loyalty_points').eq('id', customerId).single();
    expect(row?.loyalty_points).toBe(100);
  });

  it('authenticated CANNOT update lifetime_points / total_spent / last_visit_at / deleted_at', async () => {
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const admin = createClient(SUPABASE_URL, SERVICE);

    for (const patch of [
      { lifetime_points: 9999 },
      { total_spent: 9999 },
      { last_visit_at: new Date().toISOString() },
      { deleted_at: new Date().toISOString() },
    ]) {
      const { error } = await sb.from('customers').update(patch).eq('id', customerId);
      expect(error, `expected REVOKE on ${Object.keys(patch)[0]}`).not.toBeNull();
    }
    // Sanity: row is intact.
    const { data: row } = await admin.from('customers')
      .select('lifetime_points, total_spent, deleted_at').eq('id', customerId).single();
    expect(row?.lifetime_points).toBe(100);
    expect(Number(row?.total_spent)).toBe(0);
    expect(row?.deleted_at).toBeNull();
  });

  it('authenticated CANNOT INSERT into loyalty_transactions directly', async () => {
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { error } = await sb.from('loyalty_transactions').insert({
      customer_id: customerId, transaction_type: 'adjust',
      points: 50, points_balance_after: 150, description: 'direct insert attempt',
    });
    expect(error).not.toBeNull(); // RLS denies (no INSERT policy)
  });

  it('authenticated CAN soft-delete a retail customer via soft_delete_customer RPC', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data } = await admin.from('customers')
      .insert({ name: 'To Delete', phone: '+62810000096', customer_type: 'retail' })
      .select('id').single();

    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { error } = await sb.rpc('soft_delete_customer', {
      p_customer_id: data!.id, p_reason: 'duplicate record from CSV import',
    });
    expect(error).toBeNull();

    const { data: row } = await admin.from('customers').select('deleted_at').eq('id', data!.id).single();
    expect(row?.deleted_at).not.toBeNull();

    // Audit row is present with actor + payload (session 12 hardening).
    const { data: profile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP000').single();
    const { data: audit } = await admin.from('audit_log')
      .select('actor_profile_id, action, subject_table, subject_id, payload')
      .eq('subject_id', data!.id)
      .eq('action', 'customer.soft_delete')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit?.actor_profile_id).toBe(profile?.id);
    expect(audit?.subject_table).toBe('customers');
    expect((audit?.payload as { reason: string | null }).reason).toBe('duplicate record from CSV import');
  });
});

describe('soft_delete_customer RPC — failure paths', () => {
  let adminToken:   string;
  let managerToken: string;
  let customerId:   string;

  beforeAll(async () => {
    adminToken = await loginAs('EMP000', '123456');
    // MANAGER lacks customers.delete (ADMIN-only via has_permission unconditional branch).
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: c } = await admin.from('customers')
      .insert({ name: 'Delete Failure Subject', phone: '+62810000087', customer_type: 'retail' })
      .select('id').single();
    customerId = c!.id;
  });

  it('NULL p_customer_id -> invalid_input', async () => {
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${adminToken}` } } });
    const { error } = await sb.rpc('soft_delete_customer', {
      // Runtime-NULL handling.
      p_customer_id: null as unknown as string,
    });
    expect(error?.message).toMatch(/invalid_input/);
  });

  it('manager (no customers.delete) -> forbidden', async () => {
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${managerToken}` } } });
    const { error } = await sb.rpc('soft_delete_customer', { p_customer_id: customerId });
    expect(error?.message).toMatch(/forbidden/);
  });

  it('nonexistent customer UUID -> customer_deleted', async () => {
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${adminToken}` } } });
    const { error } = await sb.rpc('soft_delete_customer', {
      p_customer_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error?.message).toMatch(/customer_deleted/);
  });

  it('already-deleted customer -> customer_deleted (idempotent)', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: c } = await admin.from('customers')
      .insert({ name: 'Already Tombstoned', phone: '+62810000086', customer_type: 'retail' })
      .select('id').single();
    await admin.from('customers').update({ deleted_at: new Date().toISOString() }).eq('id', c!.id);

    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${adminToken}` } } });
    const { error } = await sb.rpc('soft_delete_customer', { p_customer_id: c!.id });
    expect(error?.message).toMatch(/customer_deleted/);
  });
});

describe('anon role — PII lockout', () => {
  it('anon CANNOT read customers PII columns', async () => {
    const sb = createClient(SUPABASE_URL, ANON); // no JWT — anon role
    const { data, error } = await sb.from('customers')
      .select('id, name, phone, email')
      .limit(1);
    // Either Postgres rejects the role with permission denied, or RLS yields
    // zero rows. Both outcomes mean PII is not leaked.
    if (error === null) {
      expect(data ?? []).toHaveLength(0);
    } else {
      expect((error?.message ?? '').toLowerCase()).toMatch(/permission denied|insufficient|access/);
    }
  });

  it('anon CANNOT read loyalty_transactions', async () => {
    const sb = createClient(SUPABASE_URL, ANON);
    const { data, error } = await sb.from('loyalty_transactions')
      .select('id, customer_id, points')
      .limit(1);
    if (error === null) {
      expect(data ?? []).toHaveLength(0);
    } else {
      expect((error?.message ?? '').toLowerCase()).toMatch(/permission denied|insufficient|access/);
    }
  });

  it('anon CANNOT call soft_delete_customer or adjust_loyalty_points', async () => {
    const sb = createClient(SUPABASE_URL, ANON);
    const r1 = await sb.rpc('soft_delete_customer', {
      p_customer_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(r1.error).not.toBeNull();
    const r2 = await sb.rpc('adjust_loyalty_points', {
      p_customer_id: '00000000-0000-0000-0000-000000000000',
      p_delta: 10,
      p_reason: 'anon attempt should be denied',
    });
    expect(r2.error).not.toBeNull();
  });
});
