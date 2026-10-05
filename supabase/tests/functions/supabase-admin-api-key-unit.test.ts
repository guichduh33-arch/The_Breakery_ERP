import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn((
  _url: string, _key: string, _options: { global: { fetch: typeof fetch } },
) => ({ rpc: vi.fn() })) }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.47.10', () => ({ createClient }));
let env: Record<string, string>;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  env = { SUPABASE_URL: 'https://example.test', SUPABASE_API_KEY_NAME: 'default',
    SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test-only"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy-server' };
  vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
});
afterEach(() => vi.unstubAllGlobals());

describe('client serveur avec nouvelle clé API', () => {
  it('retire le Bearer automatique de la clé moderne et garde apikey', async () => {
    const { getAdminClient } = await import('../../functions/_shared/supabase-admin');
    getAdminClient();
    expect(createClient.mock.calls[0][1]).toBe('sb_secret_test-only');
    const options = createClient.mock.calls[0][2];
    await options.global.fetch('https://example.test/rest/v1/test', { headers: {
      authorization: 'Bearer sb_secret_test-only', apikey: 'sb_secret_test-only',
    } });
    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Headers;
    expect(headers.has('authorization')).toBe(false);
    expect(headers.get('apikey')).toBe('sb_secret_test-only');
  });
  it('conserve une identité JWT distincte de la clé API', async () => {
    const { getAdminClient } = await import('../../functions/_shared/supabase-admin');
    getAdminClient();
    await createClient.mock.calls[0][2].global.fetch('https://example.test', {
      headers: { authorization: 'Bearer acting-user-jwt', apikey: 'sb_secret_test-only' },
    });
    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer acting-user-jwt');
  });
  it('conserve le transport legacy sans activation', async () => {
    delete env.SUPABASE_API_KEY_NAME;
    const { getAdminClient } = await import('../../functions/_shared/supabase-admin');
    getAdminClient();
    await createClient.mock.calls[0][2].global.fetch('https://example.test', {
      headers: { authorization: 'Bearer legacy-server' },
    });
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({ authorization: 'Bearer legacy-server' });
  });
});
