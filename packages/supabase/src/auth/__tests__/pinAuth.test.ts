// packages/supabase/src/auth/__tests__/pinAuth.test.ts
//
// Session 59 / S25 hard cutover — auth-change-pin PINs travel via
// x-current-pin/x-new-pin headers, never the JSON body (request bodies get
// logged by default by PostgREST/pgaudit/proxies; headers are not).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { changePin, getSession, loginWithPin } from '../pinAuth.js';

describe('loginWithPin — transport du PIN', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['pos', 'backoffice'] as const)('isole le PIN dans le header pour %s', async (device_type) => {
    const response = { auth: { access_token: 'jwt' } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(response) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loginWithPin('https://example.test', { user_id: 'profile', pin: '285741', device_type })).toBe(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/functions/v1/auth-verify-pin');
    expect(init.headers).toMatchObject({ 'x-login-pin': '285741' });
    expect(JSON.parse(init.body as string)).toEqual({ user_id: 'profile', device_type });
    expect(init.body).not.toContain('285741');
    expect(init.body).not.toContain('pin');
  });
});

describe('changePin (S25 hard cutover)', () => {
  it('transporte les échéances serveur ; aucune valeur legacy inventée', async () => {
    const clock = { created_at: '2026-09-30T01:00:00Z', last_activity_at: '2026-09-30T02:00:00Z', server_now: '2026-09-30T02:05:00Z' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u' }, permissions: [], session_clock: clock })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await getSession('https://example.invalid', 'token')).session_clock).toEqual(clock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u' }, permissions: [] })));
    expect((await getSession('https://example.invalid', 'token')).session_clock).toBeUndefined();
  });
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
