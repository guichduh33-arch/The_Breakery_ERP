import { beforeEach, describe, expect, it, vi } from 'vitest';
const api=vi.hoisted(() => ({ serve: vi.fn(), hash: vi.fn(), from: vi.fn(), rpc: vi.fn(), single: vi.fn(), eq: vi.fn() }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: api.serve }));
vi.mock('../../functions/_shared/session-auth.ts', () => ({ hashSessionToken: api.hash }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ from: api.from, rpc: api.rpc }) }));
import '../../functions/auth-logout/index';
const handler=api.serve.mock.calls[0][0] as (request: Request) => Promise<Response>;
const request=(token: string | null='opaque') => new Request('https://example.test', { method: 'POST',
  headers: token ? { 'x-session-token': token } : {}, body: JSON.stringify({ user_id: 'untrusted', session_id: 'untrusted' }) });
beforeEach(() => {
  vi.clearAllMocks(); api.hash.mockResolvedValue('hash-only');
  const query={ select: () => query, eq: api.eq, maybeSingle: api.single };
  api.eq.mockReturnValue(query); api.from.mockReturnValue(query);
  api.single.mockResolvedValue({ data: { id: 'bound-session', user_id: 'bound-profile', ended_at: null }, error: null });
  api.rpc.mockResolvedValue({ data: true, error: null });
});
describe('logout opaque — révocation sans restaurer les droits', () => {
  it('résout la cible depuis le seul secret opaque, jamais depuis le body', async () => {
    const response=await handler(request()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(api.hash).toHaveBeenCalledExactlyOnceWith('opaque');
    expect(api.eq).toHaveBeenCalledExactlyOnceWith('session_token_hash','hash-only');
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith('logout_user_session_v1',{ p_session_id: 'bound-session', p_user_id: 'bound-profile' });
  });
  it.each([null, { id: 'ended', user_id: 'profile', ended_at: '2026-10-20T00:00:00Z' }])('ACK rejouable si absence ou fin confirmée', async (data) => {
    api.single.mockResolvedValue({ data, error: null });
    expect((await handler(request())).status).toBe(200); expect(api.rpc).not.toHaveBeenCalled();
  });
  it('peut terminer une session expirée sans prolonger son activité', async () => {
    api.single.mockResolvedValue({ data: { id: 'expired', user_id: 'profile', ended_at: null, last_activity_at: '2020-01-01T00:00:00Z' }, error: null });
    expect((await handler(request())).status).toBe(200);
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith('logout_user_session_v1',{ p_session_id: 'expired', p_user_id: 'profile' });
    expect(api.from).toHaveBeenCalledExactlyOnceWith('user_sessions');
  });
  it.each([{ data: false, error: null },{ data: null, error: { message: 'audit failed' } }])('ne confirme pas une transaction incomplète', async (result) => {
    api.rpc.mockResolvedValue(result); expect((await handler(request())).status).toBe(503);
  });
  it('ne prend pas une panne de lookup pour une absence de session', async () => {
    api.single.mockResolvedValue({ data: null, error: { message: 'network' } });
    expect((await handler(request())).status).toBe(503); expect(api.rpc).not.toHaveBeenCalled();
  });
  it('conserve un rejet réseau comme temporaire', async () => {
    api.single.mockRejectedValue(new TypeError('network'));
    expect((await handler(request())).status).toBe(503);
  });
  it('ne lit rien sans token opaque', async () => {
    expect((await handler(request(null))).status).toBe(401); expect(api.from).not.toHaveBeenCalled();
  });
});
