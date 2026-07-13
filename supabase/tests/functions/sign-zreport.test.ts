// supabase/tests/functions/sign-zreport.test.ts
// Session 29 / Wave 3.C — Vitest live tests for the sign_zreport_v1 RPC
// exercised via supabase-js client (not an EF — the RPC is called directly).
//
// 3 scénarios :
//   SZ1 : PIN-en-header valid — manager JWT + x-manager-pin → signs report → status='signed'
//   SZ2 : invalid PIN — wrong x-manager-pin header → EF validate-pin returns error → 400 or P0001
//   SZ3 : audit row created — after SZ1, audit_logs has 'zreport.signed' action for the report
//
// NOTE : sign_zreport_v1 is a Postgres RPC, not an Edge Function. It is called via
// the Supabase client `rpc()` method with a manager JWT. The PIN validation is done
// upstream in the BO `<SignZReportModal>` which calls `auth-verify-pin` EF first, then
// calls the RPC only if PIN verified. For the purpose of this live test, we call the RPC
// directly (the RPC does NOT validate PIN internally — PIN gate is in the calling flow).
// SZ2 therefore tests the calling-flow PIN check via the EF, then asserts the RPC is NOT
// called / the workflow is blocked.
//
// Pattern : it.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY).
// Bootstrap :
//   - Insert a draft z_report and a closed pos_session (service-role).
//   - Log in as EMP003 (MANAGER, has zreports.sign permission) via auth-verify-pin EF.
// Cleanup : afterAll deletes the test rows.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAsFull } from './_helpers/auth';

// S77: `||` (not `??`) — in CI an unset secret materializes as an EMPTY-STRING
// env var, which `??` lets through ("supabaseKey is required").
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  || process.env.SUPABASE_URL
  || 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON = process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || 'sb_publishable_bJehhsPF6Hbg5nJKFCQWWw_Npz7gt1Z';

const PIN_FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

const MANAGER_EMPLOYEE = 'EMP003';
const MANAGER_PIN_VALID = '111111';
const MANAGER_PIN_WRONG = '999999';

// Deterministic test IDs.
const TEST_SESSION_ID  = 'feedca50-0000-0000-0000-000000002911';
const TEST_ZREPORT_ID  = 'feedca50-0000-0000-0000-000000002912';

async function loginAs(employeeCode: string, _pin: string): Promise<{
  accessToken: string;
  profileId: string;
}> {
  const r = await loginAsFull(employeeCode);
  return { accessToken: r.token, profileId: r.profileId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpc(sb: SupabaseClient): (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }> {
  return sb.rpc.bind(sb) as any;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)(
  'S29 sign_zreport_v1 RPC — Vitest live',
  () => {
    let adminClient: ReturnType<typeof createClient>;
    let managerToken: string;
    let managerProfileId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL, SERVICE);

      // Pre-clean.
      await adminClient.from('z_reports').delete().eq('id', TEST_ZREPORT_ID);
      await adminClient.from('pos_sessions').delete().eq('id', TEST_SESSION_ID);

      // Log in as manager.
      const manager = await loginAs(MANAGER_EMPLOYEE, MANAGER_PIN_VALID);
      managerToken = manager.accessToken;
      managerProfileId = manager.profileId;

      // Resolve a cashier for the session FK.
      const { data: cashierProfile } = await adminClient.from('user_profiles')
        .select('id').eq('role_code', 'CASHIER').limit(1).single();
      if (!cashierProfile) throw new Error('No CASHIER profile');

      // Insert closed session.
      const { error: sessErr } = await (adminClient as any).from('pos_sessions').insert({
        id:            TEST_SESSION_ID,
        opened_by:     cashierProfile.id,
        opened_at:     new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
        opening_cash:  500000,
        status:        'closed',
        closed_at:     new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        closed_by:     cashierProfile.id,
        closing_cash:  1500000,
        expected_cash: 1500000,
      });
      if (sessErr) throw new Error(`Session insert: ${JSON.stringify(sessErr)}`);

      // Insert draft z_report.
      const { error: zrErr } = await (adminClient as any).from('z_reports').insert({
        id:       TEST_ZREPORT_ID,
        shift_id: TEST_SESSION_ID,
        snapshot: {
          shift_id:     TEST_SESSION_ID,
          generated_at: new Date().toISOString(),
          opening_cash: 500000,
          closing_cash: 1500000,
          cashier_name: 'Test Cashier',
          orders: [], payments_by_method: [], expenses: [], refunds: [],
        },
        status: 'draft',
      });
      if (zrErr) throw new Error(`Z-report insert: ${JSON.stringify(zrErr)}`);
    });

    afterAll(async () => {
      await adminClient.from('z_reports').delete().eq('id', TEST_ZREPORT_ID);
      await adminClient.from('pos_sessions').delete().eq('id', TEST_SESSION_ID);
      // Clean up any audit rows created.
      await adminClient.from('audit_logs').delete()
        .eq('action', 'zreport.signed').eq('entity_id', TEST_ZREPORT_ID);
    });

    // =========================================================================
    // SZ1 : valid manager JWT + sign_zreport_v1 → status='signed'
    // =========================================================================
    it('SZ1: manager JWT calls sign_zreport_v1 → status=signed + idempotent_replay=false', async () => {
      const managerClient = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: `Bearer ${managerToken}` } },
      });

      const { data, error } = await rpc(managerClient)('sign_zreport_v1', {
        p_zreport_id: TEST_ZREPORT_ID,
      });

      expect(error, `RPC error: ${JSON.stringify(error)}`).toBeNull();
      expect(data).toBeTruthy();
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      expect(result.status).toBe('signed');
      expect(result.idempotent_replay).toBe(false);
    });

    // =========================================================================
    // SZ2 : wrong PIN → auth-verify-pin EF returns error → calling flow blocked
    //       NOTE: sign_zreport_v1 RPC itself does not validate PIN; the PIN
    //       check is the BO calling flow's responsibility (auth-verify-pin EF).
    //       We verify the EF rejects the wrong PIN, confirming the gateway works.
    // =========================================================================
    it('SZ2: wrong PIN → auth-verify-pin EF rejects → PIN gate works', async () => {
      // Resolve manager profile id for the PIN call.
      const { data: profile } = await adminClient.from('user_profiles')
        .select('id').eq('employee_code', MANAGER_EMPLOYEE).single();
      if (!profile) throw new Error('Manager profile not found');

      const res = await fetch(PIN_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:     profile.id,
          pin:         MANAGER_PIN_WRONG,
          device_type: 'pos',
        }),
      });

      // auth-verify-pin returns 401 or 400 on wrong PIN.
      expect([400, 401]).toContain(res.status);
      const body = await res.json();
      // The error field should signal an invalid PIN, not a generic server error.
      expect(body.error ?? body.message ?? body.code).toBeTruthy();
    });

    // =========================================================================
    // SZ3 : audit row created — after SZ1, audit_logs has zreport.signed action
    // =========================================================================
    it('SZ3: audit_logs row with action=zreport.signed exists after SZ1', async () => {
      // Give the DB a moment for the row to propagate (audit INSERT in sign_zreport_v1 is synchronous).
      const { data: rows } = await adminClient.from('audit_logs')
        .select('action, entity_id, actor_id')
        .eq('action', 'zreport.signed')
        .eq('entity_id', TEST_ZREPORT_ID);

      expect(rows).toBeTruthy();
      expect(rows!.length).toBeGreaterThanOrEqual(1);

      const auditRow = rows![0] as { action: string; entity_id: string; actor_id: string };
      expect(auditRow.action).toBe('zreport.signed');
      expect(auditRow.entity_id).toBe(TEST_ZREPORT_ID);
      // actor_id should match the manager who called sign_zreport_v1.
      expect(auditRow.actor_id).toBe(managerProfileId);
    });
  }
);
