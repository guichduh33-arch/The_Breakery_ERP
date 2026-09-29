import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ serve: vi.fn(), rpc: vi.fn(), from: vi.fn(), limit: vi.fn(), permissions: vi.fn() }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: mocks.serve }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({ checkRateLimitDurable: mocks.limit, getClientIp: () => '127.0.0.1' }));
vi.mock('../../functions/_shared/jwt.ts', () => ({ signJwt: async () => 'jwt', getJwtSecret: () => 'test-only' }));
vi.mock('../../functions/_shared/permissions.ts', () => ({
  computePermissionsForRole: mocks.permissions,
  withPermissionErrors: (handler: unknown) => handler,
}));

describe('connexion — PIN uniquement en header', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.resetModules();
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.permissions.mockResolvedValue(['pos.sale.create']);
    mocks.from.mockImplementation((table: string) => {
      const data = table === 'user_profiles'
        ? { id: 'profile', auth_user_id: 'auth', role_code: 'CASHIER', is_active: true,
          employee_code: 'TEST', failed_login_attempts: 0, role: { session_timeout_minutes: 30 } }
        : table === 'user_sessions' ? { id: 'session', created_at: '2026-09-28T00:00:00Z' } : {};
      const result = { data, error: null };
      const query = {
        select: () => query, eq: () => query, is: () => query, update: () => query, insert: () => query,
        maybeSingle: async () => result, single: async () => result,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    });
  });

  async function invoke(body: unknown, pin?: string, method = 'POST') {
    await import('../../functions/auth-verify-pin/index.ts');
    const handler = mocks.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
    return handler(new Request('https://example.test', {
      method, headers: { 'Content-Type': 'application/json', ...(pin === undefined ? {} : { 'x-login-pin': pin }) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }));
  }

  it('refuse un PIN envoyé seulement dans le JSON sans appeler la DB', async () => {
    const response = await invoke({ user_id: 'profile', pin: '285741', device_type: 'pos' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'missing_fields' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(['pos', 'backoffice'])('émet une session pour %s avec le PIN du header', async (device_type) => {
    const response = await invoke({ user_id: 'profile', device_type }, '285741');
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('verify_user_pin', { p_user_id: 'profile', p_pin: '285741' });
    expect(await response.json()).toMatchObject({ auth: { access_token: 'jwt' }, permissions: ['pos.sale.create'] });
  });

  it('ne remplace pas le header par un PIN JSON contradictoire', async () => {
    await invoke({ user_id: 'profile', device_type: 'pos', pin: '999999' }, '285741');
    expect(mocks.rpc).toHaveBeenCalledWith('verify_user_pin', { p_user_id: 'profile', p_pin: '285741' });
  });

  it('refuse le mauvais PIN vérifié par la DB', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await invoke({ user_id: 'profile', device_type: 'pos' }, '999999');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_credentials' });
    expect(mocks.from).not.toHaveBeenCalledWith('user_sessions');
  });

  it.each(['abc', '12345', '1234567'])('refuse le format invalide %s', async (pin) => {
    const response = await invoke({ user_id: 'profile', device_type: 'pos' }, pin);
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([null, [], 42])('refuse un corps JSON non objet', async (body) => {
    expect((await invoke(body, '285741')).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('autorise le nouveau header dans le preflight CORS', async () => {
    const response = await invoke(null, undefined, 'OPTIONS');
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Headers')?.split(', ')).toContain('x-login-pin');
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it('conserve le rate limit avant la vérification du PIN', async () => {
    mocks.limit.mockResolvedValue({ allowed: false, retryAfterSec: 20 });
    const response = await invoke({ user_id: 'profile', device_type: 'pos' }, '285741');
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('20');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
