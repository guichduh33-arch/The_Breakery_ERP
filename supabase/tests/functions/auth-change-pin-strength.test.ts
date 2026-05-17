// supabase/tests/functions/auth-change-pin-strength.test.ts
// Session 19 / Phase 2.B — Live smoke for auth-change-pin's weak flag.
//
// Skipped : depends on `TEST_ADMIN_USER_ID` fixture user env var which is not
// set in this repo's standard test env. Unskip once a fixture user is exposed
// (Wave 4 follow-up — DEV-S19-2.A-01 lineage). Until then, the pin-strength
// behaviour is fully covered by :
//   - packages/utils/src/__tests__/pin-strength.test.ts  (26 unit cases)
//   - supabase/tests/functions/_shared_pin-strength_sync.test.ts  (14 sentinels)

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminId     = process.env.TEST_ADMIN_USER_ID!;  // fixture user with ADMIN role + known session

describe.skip('auth-change-pin — strength flag', () => {
  let client: SupabaseClient;

  beforeAll(() => {
    client = createClient(supabaseUrl, serviceKey);
  });

  it('returns weak:true,reason:sequence for 123456', async () => {
    // (Test setup mirrors the existing auth-change-pin tests — reuse session bootstrap.)
    const { data } = await client.functions.invoke('auth-change-pin', {
      body: { user_id: adminId, current_pin: '654321', new_pin: '123456' },
    });
    expect(data?.ok).toBe(true);
    expect(data?.weak).toBe(true);
    expect(data?.weak_reason).toBe('sequence');
  });

  it('returns weak:false for 285741', async () => {
    const { data } = await client.functions.invoke('auth-change-pin', {
      body: { user_id: adminId, current_pin: '123456', new_pin: '285741' },
    });
    expect(data?.ok).toBe(true);
    expect(data?.weak).toBe(false);
    expect(data?.weak_reason).toBeUndefined();
  });
});
