import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient, fetchMock, update } = vi.hoisted(() => ({ createClient: vi.fn(), fetchMock: vi.fn(), update: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
beforeEach(() => {
  vi.clearAllMocks(); vi.resetModules();
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-only');
  vi.stubEnv('SUPABASE_URL','https://example.test');
  vi.stubEnv('VITE_SUPABASE_URL','');
  vi.stubEnv('TEST_PIN_FIXTURE','');
  vi.stubGlobal('fetch',fetchMock);
  const query = { select: () => query, eq: () => query, is: () => query,
    single: async () => ({ data: { id: 'profile', auth_user_id: 'auth' }, error: null }), update };
  createClient.mockReturnValue({ from: () => query });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const success = () => Response.json({ auth: { access_token: 'signed-pin-jwt' },
  session: { token: 'opaque', session_id: 'session' } });
describe('fixtures HTTP — vraie session PIN exigée', () => {
  it('le PIN configuré prime sur une ancienne constante appelante', async () => {
    vi.stubEnv('TEST_PIN_FIXTURE','396852');
    fetchMock.mockResolvedValue(success());
    const { loginAsFull } = await import('./_helpers/auth');
    await loginAsFull('FIXTURE','1234');
    expect(fetchMock.mock.calls[0][1].headers['x-login-pin']).toBe('396852');
  });
  it('refuse un ancien PIN de quatre chiffres avant tout réseau', async () => {
    const { loginAsFull } = await import('./_helpers/auth');
    await expect(loginAsFull('FIXTURE','1234')).rejects.toThrow('six-digit');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('ne substitue pas GoTrue à un PIN manquant', async () => {
    const { loginAsFull } = await import('./_helpers/auth');
    await expect(loginAsFull('FIXTURE')).rejects.toThrow('supply a real PIN');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
  it('transporte le PIN en header sans toucher au lockout', async () => {
    fetchMock.mockResolvedValue(success());
    const { loginAsFull } = await import('./_helpers/auth');
    expect(await loginAsFull('FIXTURE','285741')).toEqual({ token: 'signed-pin-jwt', profileId: 'profile', authUserId: 'auth' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/functions/v1/auth-verify-pin');
    expect(init.headers['x-login-pin']).toBe('285741');
    expect(JSON.parse(init.body)).toEqual({ user_id: 'profile', device_type: 'pos' });
    expect(init.body).not.toContain('285741');
    expect(update).not.toHaveBeenCalled();
  });
  it('renouvelle la session opaque au lieu de réutiliser un JWT périmé', async () => {
    fetchMock.mockResolvedValueOnce(success()).mockResolvedValueOnce(Response.json({ auth: { access_token: 'renewed-jwt' } }));
    const { loginAsFull } = await import('./_helpers/auth');
    await loginAsFull('FIXTURE','285741');
    expect((await loginAsFull('FIXTURE')).token).toBe('renewed-jwt');
    expect(fetchMock.mock.calls[1][0]).toContain('/auth-get-session');
    expect(fetchMock.mock.calls[1][1].headers['x-session-token']).toBe('opaque');
  });
  it('ne relance pas un PIN refusé et ne divulgue pas la réponse', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'invalid_pin', private_detail: 'hidden' }, { status: 401 }));
    const { loginAsFull } = await import('./_helpers/auth');
    await expect(loginAsFull('FIXTURE','285741')).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
});
