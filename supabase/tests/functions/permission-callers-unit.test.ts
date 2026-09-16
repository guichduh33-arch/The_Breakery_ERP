import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  serve: vi.fn(), insert: vi.fn(), update: vi.fn(), sign: vi.fn(),
  userRpc: vi.fn(), replay: false,
  profile: { id: 'profile', auth_user_id: 'auth', role_code: 'ADMIN', is_active: true, locked_until: null, failed_login_attempts: 0 },
}));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: mocks.serve }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.47.10', () => ({ createClient: () => ({ rpc: mocks.userRpc }) }));
vi.mock('../../functions/_shared/jwt.ts', () => ({ signJwt: mocks.sign, getJwtSecret: () => 'test-only' }));
vi.mock('../../functions/_shared/acting-user.ts', () => ({ getActingAuthUserId: async () => 'auth' }));
vi.mock('../../functions/_shared/session-auth.ts', () => ({ requireSession: async () => ({ userId: 'profile' }) }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1',
}));
vi.mock('../../functions/_shared/manager-pin.ts', () => ({
  verifyManagerPin: async () => ({ ok: true, role_code: 'ADMIN', manager_profile_id: 'profile' }),
  isManagerPinBlocked: async () => false, recordManagerPinFailure: vi.fn(), MANAGER_PIN_FAIL_WINDOW_SEC: 900,
}));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => ({
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      const response = table === 'user_permission_overrides'
        ? { data: null, error: { message: 'overrides unavailable' } }
        : { data: table === 'user_profiles' ? mocks.profile
          : table === 'role_permissions' ? [{ permission_code: 'sales.discount' }]
          : table === 'orders' ? (mocks.replay ? { id: 'existing' } : null) : {}, error: null };
      const query = {
        select: () => query, eq: () => query, is: () => query, maybeSingle: () => Promise.resolve(response),
        insert: mocks.insert, update: mocks.update,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
      };
      return query;
    },
  }),
}));

describe('callers — overrides indisponibles', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.resetModules(); mocks.replay = false;
    vi.stubGlobal('Deno', { env: { get: () => 'test-only' } });
    mocks.userRpc.mockResolvedValue({ data: { order_id: 'existing' }, error: null });
  });
  it.each([
    ['auth-verify-pin', { user_id: 'profile', pin: '285741', device_type: 'pos' }],
    ['verify-manager-pin', { mint_scope: 'discount' }],
    ['process-payment', { session_id: 'session', order_type: 'take_out', items: [{ product_id: 'product', quantity: 1, unit_price: 100 }], payment: { method: 'card', amount: 99 }, discount_amount: 1 }],
  ])('%s refuse avant session, JWT, nonce ou audit de succès', async (slug, body) => {
    await import(`../../functions/${slug}/index.ts`);
    const handler = mocks.serve.mock.calls[0]?.[0] as (req: Request) => Promise<Response>;
    const response = await handler(new Request('https://example.test', {
      method: 'POST', headers: { authorization: 'Bearer test', 'x-manager-pin': '285741' },
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'authorization_unavailable' });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });
  it('conserve le replay d’un paiement confirmé sans créer de nonce', async () => {
    mocks.replay = true;
    await import('../../functions/process-payment/index.ts');
    const handler = mocks.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
    const response = await handler(new Request('https://example.test', {
      method: 'POST', headers: { authorization: 'Bearer test' },
      body: JSON.stringify({ session_id: 'session', order_type: 'take_out',
        items: [{ product_id: 'product', quantity: 1, unit_price: 100 }],
        payment: { method: 'card', amount: 99 }, discount_amount: 1,
        idempotency_key: '12345678-1234-1234-1234-123456789012' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.userRpc).toHaveBeenCalledOnce();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
