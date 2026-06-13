// apps/pos/src/features/discounts/__tests__/use-verify-manager-pin.test.ts
//
// Session 43 (P0-1c, DEV-S43-B1-01) — useVerifyManagerPin must raw-fetch the new
// verify-manager-pin EF with the PIN in the `x-manager-pin` header (S25 pattern),
// NEVER in the JSON body, and map HTTP statuses to the VerifyResult union:
//   200 → ok (+ stash PIN for v11 re-validation at checkout)
//   429 → account_locked (SEC-07 per-IP fail bucket)
//   403 → permission_missing
//   401/400 → wrong_pin
//   network throw / anything else → unknown
// On every failure path the PIN must NOT be stashed in managerPinHolder.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('@/lib/accessToken', () => ({
  getAccessToken: vi.fn().mockResolvedValue('jwt-abc'),
}));

import { useVerifyManagerPin } from '../hooks/useVerifyManagerPin';
import { getManagerPin, clearManagerPin } from '../managerPinHolder';

const originalFetch = global.fetch;

function mockFetchResponse(status: number, body: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('useVerifyManagerPin (S43 raw fetch → verify-manager-pin EF)', () => {
  beforeEach(() => {
    clearManagerPin();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('success → POSTs to verify-manager-pin with PIN in header (not body), stashes PIN', async () => {
    // Review follow-up: the EF returns ONLY verified_user_id (full_name/role_code
    // would be gratuitous PIN→identity disclosure).
    const fetchMock = mockFetchResponse(200, { verified_user_id: 'mgr-1' });

    const verify = useVerifyManagerPin();
    const result = await verify('123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:54321/functions/v1/verify-manager-pin');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['x-manager-pin']).toBe('123456');
    expect(headers.Authorization).toBe('Bearer jwt-abc');
    expect(headers['Content-Type']).toBe('application/json');

    // S25 — the PIN must NEVER travel in the JSON body.
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ required_permission: 'sales.discount' });
    expect(init.body as string).not.toContain('123456');

    expect(result).toEqual({ ok: true, userId: 'mgr-1' });
    expect(getManagerPin()).toBe('123456');
  });

  it('threads an explicit requiredPermission into the body (default stays sales.discount)', async () => {
    const fetchMock = mockFetchResponse(200, { verified_user_id: 'mgr-1' });

    const verify = useVerifyManagerPin();
    await verify('123456', 'orders.void');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ required_permission: 'orders.void' });
  });

  it('429 (SEC-07 lockout) → account_locked, PIN not stashed', async () => {
    mockFetchResponse(429, { error: 'rate_limited' });

    const verify = useVerifyManagerPin();
    const result = await verify('123456');

    expect(result).toEqual({ ok: false, error: 'account_locked' });
    expect(getManagerPin()).toBeNull();
  });

  it('403 permission_missing → permission_missing, PIN not stashed', async () => {
    mockFetchResponse(403, { error: 'permission_missing' });

    const verify = useVerifyManagerPin();
    const result = await verify('123456');

    expect(result).toEqual({ ok: false, error: 'permission_missing' });
    expect(getManagerPin()).toBeNull();
  });

  it('401 wrong_pin → wrong_pin, PIN not stashed', async () => {
    mockFetchResponse(401, { error: 'wrong_pin' });

    const verify = useVerifyManagerPin();
    const result = await verify('999999');

    expect(result).toEqual({ ok: false, error: 'wrong_pin' });
    expect(getManagerPin()).toBeNull();
  });

  it('400 (missing/invalid pin format) → wrong_pin, PIN not stashed', async () => {
    mockFetchResponse(400, { error: 'invalid_pin_format' });

    const verify = useVerifyManagerPin();
    const result = await verify('12');

    expect(result).toEqual({ ok: false, error: 'wrong_pin' });
    expect(getManagerPin()).toBeNull();
  });

  it('network throw → unknown, PIN not stashed', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    const verify = useVerifyManagerPin();
    const result = await verify('123456');

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(getManagerPin()).toBeNull();
  });
});
