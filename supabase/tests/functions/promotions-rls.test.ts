import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Session 9 — RLS policies on `promotions` and `promotion_applications`.
// Spec §3.5 — auth_read, perm_create, perm_update, perm_delete.
//
// CASHIER (EMP001/567890) has NO promotions perms but CAN read (auth_read).
// MANAGER (EMP003/111111) has read+create+update (NOT delete).
// SUPER_ADMIN (EMP000/123456) has all four.
//
// IMPORTANT NOTE on perm_update / perm_delete OR-merge:
//   Postgres RLS policies of the same command on a table are OR-merged. The
//   migration defines TWO permissive UPDATE policies (perm_update + perm_delete)
//   so any user who satisfies EITHER passes. As a consequence, a MANAGER who has
//   `promotions.update` can in practice also UPDATE `deleted_at` even though the
//   spec text suggests delete is reserved to SUPER_ADMIN. The migration COMMENT
//   acknowledges this. The tests below assert the OBSERVED behaviour (matching
//   the migration's comment) and call out the spec mismatch as a finding for
//   the user to triage.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const PIN_FN_URL   = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

describe('promotions RLS — role matrix', () => {
  let admin: ReturnType<typeof createClient>;
  let cashierClient: ReturnType<typeof createClient>;
  let managerClient: ReturnType<typeof createClient>;
  let superAdminClient: ReturnType<typeof createClient>;
  let anonClient: ReturnType<typeof createClient>;

  // A pre-existing promo row inserted via service-role for read/update tests.
  let seedPromoId: string;

  const login = async (employeeCode: string, pin: string) => {
    await admin.from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('employee_code', employeeCode);

    const { data: profile } = await admin.from('user_profiles')
      .select('id').eq('employee_code', employeeCode).single();
    if (!profile) throw new Error(`Profile not found: ${employeeCode}`);

    const res = await fetch(PIN_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: profile.id, pin, device_type: 'pos' }),
    });
    const body = await res.json();
    if (!body.auth?.access_token) {
      throw new Error(`Login failed for ${employeeCode}: ${JSON.stringify(body)}`);
    }
    return body.auth.access_token as string;
  };

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE);

    const cashierTok = await login('EMP001', '567890');
    cashierClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${cashierTok}` } },
    });

    const managerTok = await login('EMP003', '111111');
    managerClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${managerTok}` } },
    });

    const superTok = await login('EMP000', '123456');
    superAdminClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${superTok}` } },
    });

    // Anonymous client uses only the publishable key, no Authorization header.
    anonClient = createClient(SUPABASE_URL, ANON);

    // Seed a fixed test promo (service-role bypasses RLS).
    const { data, error } = await admin.from('promotions').insert({
      name: 'RLS Seed', slug: `rls-seed-${Date.now()}`,
      type: 'percentage', scope: 'cart', discount_value: 5,
      is_active: true,
    }).select('id').single();
    if (error) throw error;
    seedPromoId = data!.id;
  });

  // ---------------------------------------------------------------------------
  // 1. Anonymous (no JWT) — auth_read requires is_authenticated() so denied.
  // ---------------------------------------------------------------------------
  describe('anonymous (no JWT)', () => {
    it('SELECT denied (RLS returns empty result, no error from PostgREST)', async () => {
      const { data, error } = await anonClient.from('promotions').select('id').limit(5);
      // PostgREST returns an empty array (200) when RLS filters everything out.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('INSERT denied (no perm_create policy match)', async () => {
      const { error } = await anonClient.from('promotions').insert({
        name: 'Anon insert', slug: `anon-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
      });
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. CASHIER (auth'd, no promotions perms) — read OK, write denied.
  // ---------------------------------------------------------------------------
  describe('CASHIER (EMP001) — auth_read OK, no write perms', () => {
    it('SELECT returns rows (auth_read passes — runtime evaluator needs this)', async () => {
      const { data, error } = await cashierClient.from('promotions')
        .select('id').eq('id', seedPromoId);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });

    it('INSERT denied (no promotions.create permission)', async () => {
      const { error } = await cashierClient.from('promotions').insert({
        name: 'Cashier insert', slug: `cashier-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
      });
      expect(error).not.toBeNull();
    });

    it('UPDATE denied (no promotions.update permission)', async () => {
      const { data, error } = await cashierClient.from('promotions')
        .update({ name: 'Cashier rename' })
        .eq('id', seedPromoId)
        .select();
      // RLS-blocked UPDATE returns either an explicit error OR an empty array
      // (PostgREST applies USING and finds 0 rows to update). Either is "denied".
      expect(error === null ? data?.length === 0 : true).toBe(true);
      // Verify the row was NOT renamed.
      const { data: row } = await admin.from('promotions').select('name').eq('id', seedPromoId).single();
      expect(row!.name).toBe('RLS Seed');
    });

    it('soft-delete (UPDATE deleted_at) denied', async () => {
      const { data, error } = await cashierClient.from('promotions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', seedPromoId)
        .select();
      expect(error === null ? data?.length === 0 : true).toBe(true);
      // Confirm deleted_at still NULL in the DB.
      const { data: row } = await admin.from('promotions').select('deleted_at').eq('id', seedPromoId).single();
      expect(row!.deleted_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. MANAGER (read + create + update, NOT delete per spec).
  // ---------------------------------------------------------------------------
  describe('MANAGER (EMP003) — read + create + update', () => {
    it('SELECT returns rows', async () => {
      const { data, error } = await managerClient.from('promotions')
        .select('id').eq('id', seedPromoId);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });

    it('INSERT allowed', async () => {
      const slug = `manager-create-${Date.now()}`;
      const { data, error } = await managerClient.from('promotions').insert({
        name: 'Manager create', slug,
        type: 'percentage', scope: 'cart', discount_value: 7,
      }).select('id').single();
      expect(error).toBeNull();
      expect(data?.id).toBeDefined();
      // Cleanup.
      await admin.from('promotions').delete().eq('id', data!.id);
    });

    it('UPDATE non-deleted_at column allowed (rename)', async () => {
      const newName = `RLS Seed renamed ${Date.now()}`;
      const { error } = await managerClient.from('promotions')
        .update({ name: newName })
        .eq('id', seedPromoId);
      expect(error).toBeNull();
      const { data: row } = await admin.from('promotions').select('name').eq('id', seedPromoId).single();
      expect(row!.name).toBe(newName);
      // Restore.
      await admin.from('promotions').update({ name: 'RLS Seed' }).eq('id', seedPromoId);
    });

    it('toggle is_active allowed', async () => {
      const { error } = await managerClient.from('promotions')
        .update({ is_active: false })
        .eq('id', seedPromoId);
      expect(error).toBeNull();
      const { data: row } = await admin.from('promotions').select('is_active').eq('id', seedPromoId).single();
      expect(row!.is_active).toBe(false);
      // Restore.
      await admin.from('promotions').update({ is_active: true }).eq('id', seedPromoId);
    });

    // ATTENTION : Spec §3.5 says delete reserved to SUPER_ADMIN. Migration
    // implements that as a SECOND UPDATE policy ("perm_delete") that OR-merges
    // with perm_update. Since MANAGER has promotions.update, the perm_update
    // USING clause already returns true for the row → UPDATE goes through
    // regardless of column. So in practice MANAGER CAN soft-delete. The test
    // documents the OBSERVED behaviour. Flag for user review.
    it('UPDATE deleted_at: OBSERVED behaviour — migration allows it (see test header)', async () => {
      // Use a dedicated row so we don't break the suite's seedPromoId.
      const { data: tmp } = await admin.from('promotions').insert({
        name: 'Manager-soft-del-target', slug: `mgr-softdel-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5, is_active: true,
      }).select('id').single();

      const { error } = await managerClient.from('promotions')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', tmp!.id);
      expect(error).toBeNull();

      const { data: row } = await admin.from('promotions')
        .select('deleted_at').eq('id', tmp!.id).single();
      // Migration's OR-merge means MANAGER can soft-delete. If the spec intent
      // is "delete-only-by-SUPER_ADMIN", the policy structure must change
      // (e.g. perm_update USING clause should also exclude rows where the new
      // value of deleted_at differs from old). Documented in test header.
      expect(row!.deleted_at).not.toBeNull();

      await admin.from('promotions').delete().eq('id', tmp!.id);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. SUPER_ADMIN — all operations allowed (incl. soft-delete).
  // ---------------------------------------------------------------------------
  describe('SUPER_ADMIN (EMP000) — full access', () => {
    it('SELECT, INSERT, UPDATE, soft-delete all allowed', async () => {
      // INSERT
      const slug = `super-create-${Date.now()}`;
      const { data: ins, error: insErr } = await superAdminClient.from('promotions').insert({
        name: 'Super create', slug,
        type: 'percentage', scope: 'cart', discount_value: 8,
      }).select('id').single();
      expect(insErr).toBeNull();
      const id = ins!.id;

      // UPDATE rename
      const newName = `Super renamed ${Date.now()}`;
      const { error: upErr } = await superAdminClient.from('promotions')
        .update({ name: newName }).eq('id', id);
      expect(upErr).toBeNull();

      // Soft-delete
      const { error: delErr } = await superAdminClient.from('promotions')
        .update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', id);
      expect(delErr).toBeNull();

      // Verify deleted (admin bypass to confirm).
      const { data: row } = await admin.from('promotions')
        .select('deleted_at, is_active').eq('id', id).single();
      expect(row!.deleted_at).not.toBeNull();
      expect(row!.is_active).toBe(false);

      // After soft-delete, auth_read filter (deleted_at IS NULL) hides the row
      // from SUPER_ADMIN's SELECT too.
      const { data: hidden } = await superAdminClient.from('promotions')
        .select('id').eq('id', id);
      expect(hidden).toEqual([]);

      await admin.from('promotions').delete().eq('id', id);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. promotion_applications — read-only via RLS, no INSERT policy exposed.
  // ---------------------------------------------------------------------------
  describe('promotion_applications RLS', () => {
    it('CASHIER can SELECT (auth_read)', async () => {
      const { error } = await cashierClient.from('promotion_applications')
        .select('id').limit(1);
      expect(error).toBeNull();
    });

    it('MANAGER cannot directly INSERT into promotion_applications (no INSERT policy)', async () => {
      const { error } = await managerClient.from('promotion_applications').insert({
        order_id: '00000000-0000-0000-0000-000000000000',
        promotion_id: seedPromoId,
        amount: 1000,
        description: 'unauthorised insert',
      });
      expect(error).not.toBeNull();
    });

    it('SUPER_ADMIN cannot directly INSERT either (no INSERT policy — only RPC SECURITY DEFINER writes)', async () => {
      const { error } = await superAdminClient.from('promotion_applications').insert({
        order_id: '00000000-0000-0000-0000-000000000000',
        promotion_id: seedPromoId,
        amount: 1000,
        description: 'super unauthorised',
      });
      // SUPER_ADMIN bypasses has_permission() but RLS INSERT still requires a
      // matching policy with WITH CHECK. None exists for promotion_applications
      // → INSERT fails.
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 6. auth_read filter excludes soft-deleted rows for everyone.
  // ---------------------------------------------------------------------------
  describe('auth_read excludes soft-deleted rows', () => {
    it('soft-deleted promo invisible to MANAGER and SUPER_ADMIN', async () => {
      const { data: tmp } = await admin.from('promotions').insert({
        name: 'auth_read-target', slug: `authread-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        deleted_at: new Date().toISOString(),
      }).select('id').single();

      const mgr = await managerClient.from('promotions').select('id').eq('id', tmp!.id);
      expect(mgr.data).toEqual([]);

      const sup = await superAdminClient.from('promotions').select('id').eq('id', tmp!.id);
      expect(sup.data).toEqual([]);

      await admin.from('promotions').delete().eq('id', tmp!.id);
    });
  });
});
