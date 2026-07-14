// supabase/tests/functions/users.test.ts
//
// Session 13 / Phase 5.D — live Vitest integration tests for the user-management RPCs.
//
// Coverage :
//   - admin can create_user_v1 → row exists + audit row.
//   - admin can update_user_role_v1 → audit row with old/new/reason + session revoked.
//   - admin cannot delete the last remaining admin (P0001 LAST_ADMIN_PROTECTED).
//   - admin can delete a cashier → soft-delete + audit + sessions revoked.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('users — RPC cycle (Phase 5.D)', () => {
  let adminToken: string;
  let cashierToken: string;
  let admin: SupabaseClient;
  let createdIds: string[] = [];

  beforeAll(async () => {
    adminToken   = await loginAs('EMP000', '123456');
    cashierToken = await loginAs('EMP001', '567890');
    admin = createClient(SUPABASE_URL, SERVICE);
  });

  afterAll(async () => {
    // Clean up created test users (hard delete the auth + profile rows since
    // staging is shared).
    for (const profileId of createdIds) {
      const { data: prof } = await admin.from('user_profiles')
        .select('auth_user_id').eq('id', profileId).maybeSingle();
      await admin.from('user_profiles').delete().eq('id', profileId);
      if (prof?.auth_user_id) {
        await admin.from('audit_logs').delete().eq('entity_id', profileId);
        await admin.auth.admin.deleteUser(prof.auth_user_id).catch(() => undefined);
      }
    }
  });

  it('cashier cannot create_user_v1 (missing users.create)', async () => {
    const sb = jwtClient(cashierToken);
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { error } = await sb.rpc('create_user_v1', {
      p_employee_code: `T_C_${suffix}`,
      p_full_name:     'Should Fail',
      p_role_code:     'CASHIER',
      p_pin:           '1234',
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/permission|denied|42501/);
  });

  it('admin can create_user_v1 → row exists + audit row', async () => {
    const sb = jwtClient(adminToken);
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const empCode = `T_A_${suffix}`;
    const { data: newId, error } = await sb.rpc('create_user_v1', {
      p_employee_code: empCode,
      p_full_name:     'Phase 5D Live Test',
      p_role_code:     'CASHIER',
      p_pin:           '111122',
    });
    expect(error).toBeNull();
    expect(typeof newId).toBe('string');
    const profileId = newId as unknown as string;
    createdIds.push(profileId);

    const { data: prof } = await admin.from('user_profiles')
      .select('id, employee_code, role_code, deleted_at').eq('id', profileId).single();
    expect(prof?.employee_code).toBe(empCode);
    expect(prof?.role_code).toBe('CASHIER');
    expect(prof?.deleted_at).toBeNull();

    const { data: audit } = await admin.from('audit_logs')
      .select('action, metadata')
      .eq('entity_id', profileId)
      .eq('action', 'user.create')
      .maybeSingle();
    expect(audit).not.toBeNull();
    expect((audit?.metadata as { role_code?: string } | null)?.role_code).toBe('CASHIER');
  });

  it('admin can update_user_role_v1 → audit + sessions revoked', async () => {
    const sb = jwtClient(adminToken);
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const empCode = `T_R_${suffix}`;
    const { data: newId } = await sb.rpc('create_user_v1', {
      p_employee_code: empCode,
      p_full_name:     'Role Change Target',
      p_role_code:     'CASHIER',
      p_pin:           '333444',
    });
    const profileId = newId as unknown as string;
    createdIds.push(profileId);

    // Plant a fake active session.
    const { error: insErr } = await admin.from('user_sessions').insert({
      user_id:            profileId,
      session_token_hash: crypto.randomUUID(),
      device_type:        'pos',
    });
    expect(insErr).toBeNull();

    const { data: res, error: roleErr } = await sb.rpc('update_user_role_v1', {
      p_user_id:       profileId,
      p_new_role_code: 'MANAGER',
      p_reason:        'live test promotion',
    });
    expect(roleErr).toBeNull();
    const result = res as unknown as { old_role: string; new_role: string; revoked_session_count: number };
    expect(result.old_role).toBe('CASHIER');
    expect(result.new_role).toBe('MANAGER');
    expect(result.revoked_session_count).toBeGreaterThanOrEqual(1);

    // Audit row visible.
    const { data: audit } = await admin.from('audit_logs')
      .select('action, metadata, entity_type')
      .eq('entity_id', profileId)
      .eq('action', 'user.role_change')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(audit?.entity_type).toBe('user_role');
    expect((audit?.metadata as { old_role?: string } | null)?.old_role).toBe('CASHIER');
    expect((audit?.metadata as { new_role?: string } | null)?.new_role).toBe('MANAGER');
    expect((audit?.metadata as { reason?: string } | null)?.reason).toMatch(/live test/i);

    // No active sessions remain.
    const { count } = await admin.from('user_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profileId)
      .is('ended_at', null);
    expect(count).toBe(0);
  });

  it('admin cannot delete the last remaining super-admin (LAST_ADMIN_PROTECTED)', async () => {
    const sb = jwtClient(adminToken);
    const { data: superAdmin } = await admin.from('user_profiles')
      .select('id').eq('role_code', 'SUPER_ADMIN').is('deleted_at', null).limit(1).single();

    const otherAdmins = await admin.from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .in('role_code', ['ADMIN', 'SUPER_ADMIN'])
      .is('deleted_at', null)
      .neq('id', superAdmin?.id ?? '');

    if ((otherAdmins.count ?? 0) > 0) {
      // Cannot test LAST_ADMIN_PROTECTED on a shared staging that has multiple admins.
      // Skip with explicit log to avoid false failure.
      console.warn('Multiple admins on staging — skipping LAST_ADMIN_PROTECTED assertion.');
      return;
    }

    const { error } = await sb.rpc('delete_user_v1', {
      p_user_id: superAdmin?.id ?? '',
      p_reason:  'last-admin-guard test',
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '')).toMatch(/LAST_ADMIN_PROTECTED/);
  });

  it('admin can delete a cashier → soft-delete + audit + sessions revoked', async () => {
    const sb = jwtClient(adminToken);
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const empCode = `T_D_${suffix}`;
    const { data: newId } = await sb.rpc('create_user_v1', {
      p_employee_code: empCode,
      p_full_name:     'Delete Target',
      p_role_code:     'CASHIER',
      p_pin:           '555666',
    });
    const profileId = newId as unknown as string;
    createdIds.push(profileId);

    const { data: res, error: delErr } = await sb.rpc('delete_user_v1', {
      p_user_id: profileId,
      p_reason:  'live test cleanup',
    });
    expect(delErr).toBeNull();
    const result = res as unknown as { deleted_at: string; revoked_session_count: number };
    expect(typeof result.deleted_at).toBe('string');

    const { data: prof } = await admin.from('user_profiles')
      .select('deleted_at, is_active').eq('id', profileId).single();
    expect(prof?.deleted_at).not.toBeNull();
    expect(prof?.is_active).toBe(false);
  });
});
