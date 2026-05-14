// supabase/tests/functions/auth-verify-pin-rate-limit.test.ts
// Session 13 / Phase 1.B — task 25-002 rate-limit hardening.
//
// Verifies the per-IP rate-limit on auth-verify-pin is 3/min (tightened from
// 20/min in v8). The 4th request within 60s from the same IP must 429.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

describe('auth-verify-pin rate-limit', () => {
  let adminUserId: string;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data } = await admin.from('user_profiles').select('id').eq('employee_code', 'EMP000').single();
    if (!data) throw new Error('Seed not loaded — run supabase db reset');
    adminUserId = data.id;
    await admin
      .from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('id', adminUserId);
  });

  it('returns 429 on the 4th invalid attempt within one minute', async () => {
    // Use a stable X-Forwarded-For so all 4 requests fall in the same bucket.
    const ip = '203.0.113.100';
    const body = JSON.stringify({ user_id: adminUserId, pin: '999999', device_type: 'pos' });

    // Requests 1-3 should hit 401 invalid_credentials (post-redaction).
    for (let i = 0; i < 3; i++) {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body,
      });
      // Either 401 (invalid_pin → redacted) or 403 (account_locked if seeds clamp)
      expect([401, 403]).toContain(res.status);
    }

    // 4th request should hit 429
    const res4 = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body,
    });
    expect(res4.status).toBe(429);
    const errBody = await res4.json();
    expect(errBody.error).toBe('rate_limited');
    expect(errBody.retry_after_sec).toBeGreaterThan(0);
  });

  it('redacts user_not_found to invalid_credentials', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.200', // different IP to avoid rate-limit
      },
      body: JSON.stringify({
        user_id: '00000000-0000-0000-0000-000000000999',
        pin: '123456',
        device_type: 'pos',
      }),
    });
    expect(res.status).toBe(401);
    const errBody = await res.json();
    expect(errBody.error).toBe('invalid_credentials');
  });
});
