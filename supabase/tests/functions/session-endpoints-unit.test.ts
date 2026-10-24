import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ serve: vi.fn(), session: vi.fn(), rpc: vi.fn(), from: vi.fn(), sign: vi.fn() }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: mocks.serve }));
vi.mock('../../functions/_shared/session-auth.ts', () => ({ requireSession: mocks.session, hashSessionToken: async () => 'token-hash' }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('../../functions/_shared/jwt.ts', () => ({ signJwt: mocks.sign, getJwtSecret: () => 'test-only' }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1',
}));

describe('sessions — restauration et activité séparées', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.resetModules();
    mocks.session.mockResolvedValue({ userId: 'profile', sessionId: 'session', permissions: ['orders.read'], sessionTimeoutMinutes: 120,
      createdAt: '2026-09-30T01:00:00Z', lastActivityAt: '2026-09-30T02:00:00Z' });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.sign.mockResolvedValue('fresh-jwt');
    mocks.from.mockImplementation((table: string) => {
      const query = { select: () => query, eq: () => query, is: () => query,
        maybeSingle: async () => ({ data: table === 'user_sessions' ? { id: 'session', user_id: 'profile', ended_at: null }
          : { id: 'profile', auth_user_id: 'auth', is_active: true, role_code: 'CHANGED_ROLE' }, error: null }) };
      return query;
    });
  });
  async function invoke(slug: string) {
    await import(`../../functions/${slug}/index.ts`);
    return (mocks.serve.mock.calls[0][0] as (req: Request) => Promise<Response>)(new Request('https://example.test', {
      method: 'POST', headers: { 'x-session-token': 'opaque' },
    }));
  }
  it('rafraîchit le JWT en conservant le snapshot sans écrire l’activité', async () => {
    const response = await invoke('auth-get-session');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ permissions: ['orders.read'], session_timeout_minutes: 120, auth: { access_token: 'fresh-jwt' },
      session_clock: { created_at: '2026-09-30T01:00:00Z', last_activity_at: '2026-09-30T02:00:00Z', server_now: expect.any(String) } });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('user_profiles');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sub: 'auth', session_id: 'session', app_metadata: { provider: 'pin' },
    }), 'test-only');
  });
  it('attend la confirmation SQL avant d’acquitter le heartbeat', async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockReturnValue(new Promise((done) => { resolve = done; }));
    let completed = false;
    const response = invoke('auth-session-activity').then((value) => { completed = true; return value; });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    resolve({ data: true, error: null });
    expect((await response).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('touch_user_session_v1', { p_session_id: 'session' });
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it.each([[false, null, 401], [null, { message: 'offline' }, 503]])('refuse une écriture non confirmée', async (data, error, status) => {
    mocks.rpc.mockResolvedValue({ data, error });
    expect((await invoke('auth-session-activity')).status).toBe(status);
  });
  it('acquitte le logout après révocation et audit SQL atomiques', async () => {
    const response = await invoke('auth-logout');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('logout_user_session_v1', { p_session_id: 'session', p_user_id: 'profile' });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('user_sessions');
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it.each([[false, null, 503], [null, { message: 'audit failed' }, 503]])('ne confirme pas un logout refusé', async (data, error, status) => {
    mocks.rpc.mockResolvedValue({ data, error });
    expect((await invoke('auth-logout')).status).toBe(status);
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('user_sessions');
  });
  it('ne touche pas une session déjà refusée', async () => {
    mocks.session.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await invoke('auth-session-activity')).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
