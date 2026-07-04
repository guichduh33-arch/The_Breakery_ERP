// packages/supabase/src/auth/__tests__/pinAuth.test.ts
//
// Session 59 / S25 hard cutover — auth-change-pin PINs travel via
// x-current-pin/x-new-pin headers, never the JSON body (request bodies get
// logged by default by PostgREST/pgaudit/proxies; headers are not).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { changePin } from '../pinAuth.js';

describe('changePin (S25 hard cutover)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends current_pin/new_pin as headers and only user_id in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await changePin('http://localhost:54321', 'session-token-abc', {
      user_id: 'u1',
      current_pin: '111111',
      new_pin: '222222',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:54321/functions/v1/auth-change-pin');
    expect(init.headers).toMatchObject({
      'x-session-token': 'session-token-abc',
      'x-current-pin': '111111',
      'x-new-pin': '222222',
    });

    const bodyStr = init.body as string;
    expect(JSON.parse(bodyStr)).toEqual({ user_id: 'u1' });
    expect(bodyStr).not.toMatch(/current_pin|new_pin|111111|222222/);
  });

  it('omits x-current-pin on admin override (no current_pin)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await changePin('http://localhost:54321', 'session-token-abc', {
      user_id: 'u2',
      new_pin: '333333',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('x-current-pin');
    expect((init.headers as Record<string, string>)['x-new-pin']).toBe('333333');
  });
});
