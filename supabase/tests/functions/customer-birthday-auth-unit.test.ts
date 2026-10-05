import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { serve, getUser, from, rpc, env } = vi.hoisted(() => ({
  serve: vi.fn(), getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), env: vi.fn(),
}));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve }));
vi.mock('../../functions/_shared/cors.ts', () => ({
  handleCors: () => null,
  jsonResponse: (body: unknown, status = 200) => Response.json(body, { status }),
}));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => ({ auth: { getUser }, from, rpc }),
}));
import '../../functions/customer-birthday-notify/index';

const handler = serve.mock.calls[0][0] as (req: Request) => Promise<Response>;

describe('anniversaires — accès réservé aux appels serveur', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Deno', { env: { get: env } });
    env.mockImplementation((name: string) => ({
      BIRTHDAY_CRON_SECRET: 'test-cron-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    })[name]);
    getUser.mockImplementation(async (token: string) => token === 'ordinary-valid-user-token'
      ? { data: { user: { id: 'ordinary-user' } }, error: null }
      : { data: { user: null }, error: { message: 'Invalid token' } });
    const query = {
      select: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    from.mockReturnValue(query);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {},
    { authorization: 'Bearer ordinary-valid-user-token' },
    { authorization: 'Bearer forged-token' },
    { 'x-cron-secret': 'wrong-secret' },
    { authorization: 'Bearer ' },
  ])('refuse %j avant tout accès métier', async (headers) => {
    const response = await handler(new Request('https://example.test/birthday', {
      method: 'POST', headers,
    }));
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { 'x-cron-secret': 'test-cron-secret' },
    { authorization: 'Bearer test-service-key' },
  ])('accepte le justificatif serveur configuré %j', async (headers) => {
    const response = await handler(new Request('https://example.test/birthday', {
      method: 'POST', headers,
    }));
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledExactlyOnceWith('customers');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('refuse tous les justificatifs si les secrets serveur sont absents', async () => {
    env.mockReturnValue(undefined);
    const response = await handler(new Request('https://example.test/birthday', {
      method: 'POST', headers: { authorization: 'Bearer ordinary-valid-user-token' },
    }));
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepte la nouvelle clé serveur dans apikey', async () => {
    env.mockImplementation((name: string) => ({
      SUPABASE_API_KEY_NAME: 'default',
      SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test-only"}',
    })[name]);
    const response = await handler(new Request('https://example.test/birthday', {
      method: 'POST', headers: { apikey: 'sb_secret_test-only' },
    }));
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledExactlyOnceWith('customers');
  });

  it.each(['test-service-key', 'sb_secret_test-only', 'ordinary-valid-user-token'])
    ('refuse Bearer après migration des clés : %s', async token => {
      env.mockImplementation((name: string) => ({
        SUPABASE_API_KEY_NAME: 'default',
        SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test-only"}',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      })[name]);
      const response = await handler(new Request('https://example.test/birthday', {
        method: 'POST', headers: { authorization: `Bearer ${token}` },
      }));
      expect(response.status).toBe(401);
      expect(from).not.toHaveBeenCalled();
    });
});
