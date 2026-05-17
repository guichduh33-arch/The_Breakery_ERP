// supabase/tests/functions/role-session-timeout.test.ts
// Session 19 / Phase 1.B — Vitest live RPC stub for update_role_session_timeout_v1.
//
// Status: SKIPPED until Phase 3.A wires the BO /settings/security consumer.
// Coverage to add when unskipped:
//   - admin caller can update CASHIER timeout end-to-end (cloud RPC)
//   - non-admin caller is rejected (P0003)
//   - bounds rejection (P0001)
//   - audit log row visible after success

import { describe, it, expect } from 'vitest';

// SKIP: re-enable in Phase 3.A once BO consumer wires the RPC.
describe.skip('update_role_session_timeout_v1 (live)', () => {
  it('admin can update CASHIER timeout', async () => {
    expect(true).toBe(true);
  });
});
