import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@breakery/supabase';
const api = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn(), bearer: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://logout.test' }));
vi.mock('@breakery/supabase', async (original) => ({ ...await original<typeof Api>(),
  loginWithPin: api.login, logoutSession: api.logout, setSupabaseAccessToken: api.bearer }));
import { useAuthStore, sessionRevocations } from '../authStore';
const response = (id: string) => ({ user: { id, full_name: id, employee_code: id, role_code: 'MANAGER' },
  session: { token: `opaque-${id}`, session_id: id, created_at: new Date().toISOString() },
  auth: { access_token: `jwt-${id}`, refresh_token: '', expires_at: Date.now()/1000+3600 }, permissions: ['orders.read'] });
function establish(id: string) { useAuthStore.setState({ user: response(id).user, sessionToken: `opaque-${id}`, isAuthenticated: true, isLoading: false }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; }
beforeEach(async () => {
  api.logout.mockResolvedValue(undefined);
  await sessionRevocations.retry();
  await useAuthStore.getState().logout();
  await sessionRevocations.retry();
  sessionStorage.clear(); vi.clearAllMocks(); api.logout.mockResolvedValue(undefined);
});
describe('logout local et révocation durable isolés', () => {
  it('ferme immédiatement A, garde la tentative après panne et ne perturbe pas B', async () => {
    establish('A'); const remote=deferred<void>(); api.logout.mockReturnValueOnce(remote.promise);
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState()).toMatchObject({ user: null, sessionToken: null, isAuthenticated: false, isLoading: false });
    expect(sessionRevocations.getSnapshot().pending).toBe(1);
    const key=Object.keys(sessionStorage).find((name) => name.includes('pending-logouts'))!;
    expect(sessionStorage.getItem(key)).toBe('["opaque-A"]');
    api.login.mockResolvedValue(response('B')); await useAuthStore.getState().login('B','285741');
    remote.reject(new Error('network')); await sessionRevocations.retry();
    expect(sessionRevocations.getSnapshot().pending).toBe(1);
    expect(useAuthStore.getState().user?.id).toBe('B');
    await sessionRevocations.retry();
    expect(sessionRevocations.getSnapshot().pending).toBe(0);
    expect(useAuthStore.getState().user?.id).toBe('B');
    expect(api.bearer).toHaveBeenLastCalledWith('jwt-B');
  });
  it('ne ressuscite pas un login remplacé et révoque sa session tardive', async () => {
    const old=deferred<ReturnType<typeof response>>();
    api.login.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('B'));
    const pending=useAuthStore.getState().login('A','285741');
    await useAuthStore.getState().login('B','285741');
    old.resolve(response('A')); expect(await pending).toBe(false); await sessionRevocations.retry();
    expect(useAuthStore.getState().user?.id).toBe('B');
    expect(api.logout).toHaveBeenCalledWith('https://logout.test','opaque-A');
    expect(api.bearer).toHaveBeenLastCalledWith('jwt-B');
  });
});
