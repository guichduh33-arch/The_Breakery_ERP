// supabase/tests/functions/rate-limit-durable.test.ts
// Session 19 / Phase 1.A — Live RPC smoke for record_rate_limit_v1.
// Note: this file is SKIPPED until Phase 2.A wires checkRateLimitDurable.

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

describe.skip('record_rate_limit_v1 (live)', () => {
  const supabase = createClient(supabaseUrl, serviceKey);

  it('enforces max_per_window across two clients', async () => {
    const args = { p_function_name: 'vitest-fn', p_bucket_key: 'vitest-' + Date.now(), p_ip_address: '127.0.0.1', p_max_per_window: 3, p_window_sec: 60 };

    // 3 allowed
    for (let i = 0; i < 3; i++) {
      const { data, error } = await supabase.rpc('record_rate_limit_v1', args);
      expect(error).toBeNull();
      expect(data?.[0]?.allowed).toBe(true);
    }
    // 4th rejected
    const { data, error } = await supabase.rpc('record_rate_limit_v1', args);
    expect(error).toBeNull();
    expect(data?.[0]?.allowed).toBe(false);
    expect(data?.[0]?.retry_after_sec).toBeGreaterThanOrEqual(0);
  });
});
