// supabase/tests/functions/rate-limit-retry-after.test.ts
// Session 22 / Phase 1.B.2 — DEV-S19-2.A-02 — Retry-After header surfacing.
//
// All five rate-limited Edge Functions emit a 429 with a `Retry-After` header
// (integer seconds, exposed via Access-Control-Expose-Headers) and the
// historical body `{ error, retry_after_sec }` shape is preserved.
//
// We saturate each EF's IP bucket with `x-forwarded-for` pinned to a distinct
// IP per test (to avoid cross-test bleed) and assert the response carries
// `Retry-After: \d+` with an integer in [1, 60].
//
// Notes :
//  - `auth-verify-pin` rate-limit is 3/min (tightened in S13). 4th request 429s.
//  - `kiosk-issue-jwt` IP bucket is 10/min ; we send 11 to trip it.
//  - `refund-order`, `void-order`, `cancel-item` IP buckets are 10/min ; same
//    pattern (no auth header needed — rate-limit triggers before auth check).
//
// Env  : VITE_SUPABASE_URL must point at the V3 dev project
//        (https://ikcyvlovptebroadgtvd.supabase.co/functions/v1). SUPABASE_ANON_KEY
//        not required for these calls (rate-limit triggers before auth).

import { describe, it, expect } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const FN_BASE = `${SUPABASE_URL}/functions/v1`;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

/**
 * Burst a function with `count` requests pinned to a single IP. Returns the
 * first 429 response (or undefined if none surfaced).
 */
async function burstUntil429(
  fnSlug: string,
  ip: string,
  count: number,
  body: unknown,
): Promise<Response | undefined> {
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${FN_BASE}/${fnSlug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
        // Anon key is required by the platform proxy even when the EF body
        // doesn't authenticate the caller (the rate-limit gate fires first).
        apikey: ANON_KEY,
        authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) return res;
    // Drain body to avoid socket leak.
    await res.text().catch(() => undefined);
  }
  return undefined;
}

function assertRetryAfter(res: Response | undefined, label: string): void {
  expect(res, `${label} — expected at least one 429 in burst`).toBeDefined();
  if (!res) return;
  expect(res.status, `${label} — status is 429`).toBe(429);
  const ra = res.headers.get('Retry-After');
  expect(ra, `${label} — Retry-After header is present`).toBeTruthy();
  expect(ra!, `${label} — Retry-After matches /^\\d+$/`).toMatch(/^\d+$/);
  const n = Number.parseInt(ra!, 10);
  expect(n, `${label} — Retry-After is in [1, 60]`).toBeGreaterThanOrEqual(1);
  expect(n, `${label} — Retry-After is in [1, 60]`).toBeLessThanOrEqual(60);
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('S22 / 1.B.2 — Retry-After header on 5 rate-limited EFs', () => {
  it('auth-verify-pin sets Retry-After on 429', async () => {
    const res = await burstUntil429(
      'auth-verify-pin',
      '203.0.113.211',
      6,
      { user_id: '00000000-0000-0000-0000-000000000999', pin: '999999', device_type: 'pos' },
    );
    assertRetryAfter(res, 'auth-verify-pin');
  });

  it('kiosk-issue-jwt sets Retry-After on 429 (IP bucket)', async () => {
    const res = await burstUntil429(
      'kiosk-issue-jwt',
      '203.0.113.212',
      13,
      { kiosk_id: 'rate-test-kiosk', scope: 'kds' },
    );
    assertRetryAfter(res, 'kiosk-issue-jwt');
  });

  it('refund-order sets Retry-After on 429', async () => {
    const res = await burstUntil429(
      'refund-order',
      '203.0.113.213',
      13,
      {
        order_id: '00000000-0000-0000-0000-000000000000',
        lines: [],
        tenders: [],
        reason: 'rate-limit test',
        manager_pin: '000000',
      },
    );
    assertRetryAfter(res, 'refund-order');
  });

  it('void-order sets Retry-After on 429', async () => {
    const res = await burstUntil429(
      'void-order',
      '203.0.113.214',
      13,
      {
        order_id: '00000000-0000-0000-0000-000000000000',
        reason: 'rate-limit test',
        manager_pin: '000000',
      },
    );
    assertRetryAfter(res, 'void-order');
  });

  it('cancel-item sets Retry-After on 429', async () => {
    const res = await burstUntil429(
      'cancel-item',
      '203.0.113.215',
      13,
      {
        order_item_id: '00000000-0000-0000-0000-000000000000',
        reason: 'rate-limit test',
        manager_pin: '000000',
      },
    );
    assertRetryAfter(res, 'cancel-item');
  });
});
