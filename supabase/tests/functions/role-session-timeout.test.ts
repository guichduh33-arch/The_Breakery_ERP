// supabase/tests/functions/role-session-timeout.test.ts
// Session 19 / Phase 1.B — Vitest live RPC smoke for update_role_session_timeout_v1.
// Unskipped in Phase 3.A now that the BO /settings/security consumer is wired.
//
// Coverage:
//   - admin (JWT-impersonated) caller updates CASHIER timeout end-to-end (cloud RPC)
//   - service-role caller (no auth.uid) is rejected with P0003 unauthenticated
//   - bounds rejection (P0001) for an out-of-range value
//   - audit log row 'role.session_timeout_changed' appears after a successful change
//
// NOTE (DEV-S19-2.A-01 / mirrors the S18 caveat) : the RPC enforces
// `auth.uid()` + admin role at the DB layer, so it cannot be exercised with a
// pure service-role client. A signed-in admin JWT is required for the
// happy-path test. The env vars `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
// AND `BREAKERY_ADMIN_JWT` (a freshly-minted admin session token) must all
// be exported — none of them are loaded in the typical dev shell on this
// machine, so the suite skips the happy-path assertion and only runs the
// service-role rejection check (which works without a JWT). Authoritative
// coverage is the pgTAP suite (Phase 1.B) run vs V3 dev nightly.

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.VITE_SUPABASE_URL ?? '';
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const adminJwt     = process.env.BREAKERY_ADMIN_JWT ?? '';
const hasBaseEnv   = Boolean(supabaseUrl && serviceKey);

const rpcName = 'update_role_session_timeout_v1' as never;

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('update_role_session_timeout_v1 (live)', () => {
  if (!hasBaseEnv) {
    it.skip('skipped — VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set', () => undefined);
    return;
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  it('service-role client (no auth.uid) is rejected — proves the gate (P0003)', async () => {
    const { data, error } = await serviceClient.rpc(rpcName, {
      p_role_code: 'CASHIER',
      p_minutes: 30,
    } as never);
    // The function raises 'unauthenticated' / P0003. The supabase-js client
    // surfaces it on the `error` channel, not `data`.
    expect(data).toBeFalsy();
    expect(error).not.toBeNull();
    expect(String(error!.message)).toMatch(/unauthenticated|forbidden|admin_only/i);
  });

  if (!adminJwt) {
    // Without an admin JWT we cannot exercise the happy path. Document the
    // caveat and stop here — pgTAP holds the authoritative coverage.
    it.skip('skipped happy path — BREAKERY_ADMIN_JWT not provided', () => undefined);
    return;
  }

  // BREAKERY_ADMIN_JWT is a freshly-minted ADMIN session token (the same JWT
  // the BO browser tab would carry). It overrides auth.uid() so the RPC's
  // permission gate accepts the call.
  const adminClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${adminJwt}` } },
  });

  it('admin can update the CASHIER timeout to 45 then reset to 30', async () => {
    const update1 = await adminClient.rpc(rpcName, { p_role_code: 'CASHIER', p_minutes: 45 } as never);
    expect(update1.error).toBeNull();
    expect(update1.data).toBe(true);

    const after = await serviceClient
      .from('roles')
      .select('session_timeout_minutes' as 'name')
      .eq('code', 'CASHIER')
      .single();
    expect(after.error).toBeNull();
    expect((after.data as unknown as { session_timeout_minutes: number }).session_timeout_minutes).toBe(45);

    const reset = await adminClient.rpc(rpcName, { p_role_code: 'CASHIER', p_minutes: 30 } as never);
    expect(reset.error).toBeNull();
    expect(reset.data).toBe(true);
  });

  it('rejects out-of-range values (P0001)', async () => {
    const tooLow  = await adminClient.rpc(rpcName, { p_role_code: 'CASHIER', p_minutes: 1   } as never);
    expect(tooLow.error).not.toBeNull();
    const tooHigh = await adminClient.rpc(rpcName, { p_role_code: 'CASHIER', p_minutes: 999 } as never);
    expect(tooHigh.error).not.toBeNull();
  });

  it('writes an audit_logs row tagged role.session_timeout_changed (D9)', async () => {
    const before = Date.now();
    const update = await adminClient.rpc(rpcName, { p_role_code: 'CASHIER', p_minutes: 31 } as never);
    expect(update.error).toBeNull();

    const { data: rows, error } = await serviceClient
      .from('audit_logs')
      .select('id, action, entity_type, payload, created_at')
      .eq('entity_type', 'roles')
      .eq('action', 'role.session_timeout_changed')
      .gte('created_at', new Date(before - 5_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(rows && rows.length).toBeGreaterThan(0);

    // Cleanup.
    await adminClient.rpc(rpcName, { p_role_code: 'CASHIER', p_minutes: 30 } as never);
  });
});
