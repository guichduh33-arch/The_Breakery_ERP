import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginResponse } from '@breakery/supabase';
import type * as BreakerySupabase from '@breakery/supabase';

const api = vi.hoisted(() => ({ login: vi.fn(), session: vi.fn(), logout: vi.fn(), bearer: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabaseUrl: 'https://test.invalid' }));
vi.mock('@breakery/supabase', async (original) => ({
  ...await original<typeof BreakerySupabase>(),
  loginWithPin: api.login, getSession: api.session, logoutSession: api.logout,
  setSupabaseAccessToken: api.bearer,
}));

import { useAuthStore } from '../authStore.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function loginResponse(id: string): LoginResponse {
  return {
    user: { id, full_name: id, employee_code: id, role_code: 'MANAGER' },
    session: { token: `session-${id}`, session_id: id, created_at: '2026-10-20T00:00:00Z' },
    auth: { access_token: `bearer-${id}`, refresh_token: `refresh-${id}`, expires_at: Date.now() / 1000 + 3600 },
    permissions: ['orders.read'], session_timeout_minutes: 60,
  };
}

function sessionResponse(id: string) {
  const response = loginResponse(id);
  return { ...response.user, auth: response.auth, permissions: response.permissions, session_timeout_minutes: 60 };
}

function establish(id: string) {
  const response = loginResponse(id);
  useAuthStore.setState({
    user: response.user, sessionToken: response.session.token, isAuthenticated: true,
    permissions: response.permissions, authSnapshot: null, bootstrapStatus: 'ready',
    sessionTimeoutMinutes: 60, error: null, isLoading: false,
  });
}

async function loginB() {
  api.login.mockResolvedValueOnce(loginResponse('B'));
  expect(await useAuthStore.getState().login('B', '285741')).toBe(true);
}

beforeEach(async () => {
  vi.resetAllMocks();
  api.logout.mockResolvedValue(undefined);
  await useAuthStore.getState().logout();
  api.logout.mockClear();
  api.bearer.mockClear();
});

describe('isolation des opérations d’authentification', () => {
  const staleReads = (['bootstrap', 'validateSession'] as const).flatMap((method) =>
    (['success', '401', '500'] as const).map((outcome) => ({ method, outcome })));

  it.each(staleReads)('ignore $method A ($outcome) après logout puis login B', async ({ method, outcome }) => {
    establish('A');
    const old = deferred<ReturnType<typeof sessionResponse>>();
    api.session.mockReturnValueOnce(old.promise);
    const reading = useAuthStore.getState()[method]();
    await useAuthStore.getState().logout();
    await loginB();
    api.logout.mockClear();

    if (outcome === 'success') old.resolve(sessionResponse('A'));
    else old.reject(Object.assign(new Error('old request'), { status: Number(outcome) }));
    await reading;

    expect(useAuthStore.getState()).toMatchObject({
      user: { id: 'B' }, sessionToken: 'session-B', isAuthenticated: true,
      isLoading: false, bootstrapStatus: 'ready', error: null,
    });
    expect(api.bearer).toHaveBeenLastCalledWith('bearer-B');
    expect(api.logout).not.toHaveBeenCalled();
  });

  it.each(['bootstrap', 'validateSession'] as const)('ne ressuscite pas A après logout pendant %s', async (method) => {
    establish('A');
    const old = deferred<ReturnType<typeof sessionResponse>>();
    api.session.mockReturnValueOnce(old.promise);
    const reading = useAuthStore.getState()[method]();
    await useAuthStore.getState().logout();
    old.resolve(sessionResponse('A'));
    await reading;
    expect(useAuthStore.getState()).toMatchObject({ user: null, sessionToken: null, isAuthenticated: false });
    expect(api.bearer).toHaveBeenLastCalledWith(null);
  });

  it.each(['success', 'failure'] as const)('logout local immédiat, révocation tardive %s sans effet sur B', async (outcome) => {
    establish('A');
    const remote = deferred<void>();
    api.logout.mockReturnValueOnce(remote.promise);
    const leaving = useAuthStore.getState().logout();
    expect(useAuthStore.getState()).toMatchObject({ sessionToken: null, isAuthenticated: false, isLoading: false });
    expect(api.bearer).toHaveBeenLastCalledWith(null);
    await leaving;
    await loginB();
    if (outcome === 'success') remote.resolve();
    else remote.reject(new Error('network'));
    await remote.promise.catch(() => undefined);
    expect(api.logout).toHaveBeenCalledWith('https://test.invalid', 'session-A');
    expect(useAuthStore.getState().user?.id).toBe('B');
    expect(api.bearer).toHaveBeenLastCalledWith('bearer-B');
  });

  it.each(['old-first', 'new-first'] as const)('seul le dernier login publie sa session (%s)', async (order) => {
    const a = deferred<LoginResponse>();
    const b = deferred<LoginResponse>();
    api.login.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = useAuthStore.getState().login('A', '285741');
    const second = useAuthStore.getState().login('B', '285741');
    if (order === 'old-first') {
      a.resolve(loginResponse('A'));
      expect(await first).toBe(false);
      expect(useAuthStore.getState().isLoading).toBe(true);
      expect(api.bearer).not.toHaveBeenCalled();
    }
    b.resolve(loginResponse('B'));
    expect(await second).toBe(true);
    if (order === 'new-first') { a.resolve(loginResponse('A')); expect(await first).toBe(false); }
    expect(useAuthStore.getState().user?.id).toBe('B');
    expect(api.bearer).toHaveBeenCalledExactlyOnceWith('bearer-B');
  });

  it('une erreur du login remplacé ne retire pas le chargement du suivant', async () => {
    const a = deferred<LoginResponse>();
    const b = deferred<LoginResponse>();
    api.login.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = useAuthStore.getState().login('A', '285741');
    const second = useAuthStore.getState().login('B', '285741');
    a.reject(new Error('wrong_pin'));
    expect(await first).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({ isLoading: true, error: null });
    b.resolve(loginResponse('B'));
    expect(await second).toBe(true);
  });

  it('une erreur ancienne ne remplace pas celle du dernier login', async () => {
    const a = deferred<LoginResponse>();
    api.login.mockReturnValueOnce(a.promise).mockRejectedValueOnce(new Error('account_locked'));
    const first = useAuthStore.getState().login('A', '285741');
    await expect(useAuthStore.getState().login('B', '285741')).rejects.toThrow('account_locked');
    a.reject(new Error('wrong_pin'));
    expect(await first).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({ error: 'account_locked', isLoading: false });
  });

  it('logout invalide aussi un login qui n’a pas encore de token', async () => {
    const remote = deferred<LoginResponse>();
    api.login.mockReturnValueOnce(remote.promise);
    const loggingIn = useAuthStore.getState().login('A', '285741');
    await useAuthStore.getState().logout();
    remote.resolve(loginResponse('A'));
    expect(await loggingIn).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, sessionToken: null, isLoading: false });
  });

  it.each(['success', '401'] as const)('login en cours invalide la validation A (%s)', async (outcome) => {
    establish('A');
    const old = deferred<ReturnType<typeof sessionResponse>>();
    const next = deferred<LoginResponse>();
    api.session.mockReturnValueOnce(old.promise);
    api.login.mockReturnValueOnce(next.promise);
    const reading = useAuthStore.getState().validateSession();
    const loggingIn = useAuthStore.getState().login('B', '285741');
    if (outcome === 'success') old.resolve(sessionResponse('A'));
    else old.reject(Object.assign(new Error('revoked A'), { status: 401 }));
    await reading;
    expect(useAuthStore.getState()).toMatchObject({ isLoading: true, error: null });
    expect(api.logout).not.toHaveBeenCalled();
    await useAuthStore.getState().bootstrap();
    expect(api.session).toHaveBeenCalledOnce();
    next.resolve(loginResponse('B'));
    expect(await loggingIn).toBe(true);
  });

  it.each(['success', '401', '500'] as const)('bootstrap et refresh partagent une lecture en vol (%s)', async (outcome) => {
    establish('A');
    const remote = deferred<ReturnType<typeof sessionResponse>>();
    api.session.mockReturnValueOnce(remote.promise);
    const first = useAuthStore.getState().bootstrap();
    const second = useAuthStore.getState().bootstrap();
    const refresh = useAuthStore.getState().validateSession();
    expect(api.session).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().bootstrapStatus).toBe('loading');
    if (outcome === 'success') remote.resolve(sessionResponse('A'));
    else remote.reject(Object.assign(new Error('read failed'), { status: Number(outcome) }));
    await Promise.all([first, second, refresh]);
    expect(useAuthStore.getState().bootstrapStatus).toBe(outcome === '500' ? 'error' : 'ready');
    expect(useAuthStore.getState().isAuthenticated).toBe(outcome !== '401');
    expect(api.logout).toHaveBeenCalledTimes(outcome === '401' ? 1 : 0);
  });
});
