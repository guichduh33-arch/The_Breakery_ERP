import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ serve: vi.fn(), rpc: vi.fn(), admin: vi.fn(), pin: vi.fn(), verify: vi.fn() }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: mocks.serve }));
vi.mock('https://deno.land/x/djwt@v3.0.2/mod.ts', () => ({ verify: mocks.verify }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.47.10', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: () => Promise.resolve({ allowed: true }), getClientIp: () => '127.0.0.1',
}));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: mocks.admin }));
vi.mock('../../functions/_shared/manager-pin.ts', () => ({
  verifyManagerPin: mocks.pin, isManagerPinBlocked: vi.fn(), recordManagerPinFailure: vi.fn(), MANAGER_PIN_FAIL_WINDOW_SEC: 900,
}));
vi.mock('../../functions/_shared/permissions.ts', () => ({
  withPermissionErrors: (handler: unknown) => handler, checkPermissionForRole: vi.fn(),
}));

describe('paiement — identité vérifiée avant les accès métier', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.resetModules();
    mocks.verify.mockResolvedValue({ role: 'authenticated', sub: 'employee', app_metadata: { provider: 'pin' } });
    vi.stubGlobal('Deno', { env: { get: (name: string) => ({
      JWT_SECRET: 'test-only-signing-secret', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'test-only',
    })[name] } });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function invoke(authorization: string | undefined = 'Bearer test', discount = true) {
    await import('../../functions/process-payment/index.ts');
    const handler = mocks.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
    return handler(new Request('https://example.test', {
      method: 'POST', headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json', 'x-manager-pin': 'test-only' },
      body: JSON.stringify({ session_id: 'session', order_type: 'take_out',
        items: [{ product_id: 'product', quantity: 1, unit_price: 100 }], payment: { method: 'card', amount: 100 },
        ...(discount ? { idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', discount_amount: 10 } : {}),
      }),
    }));
  }

  async function expectRejected(authorization = 'Bearer test') {
    const response = await invoke(authorization);
    expect(response.status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.pin).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  }

  it.each(['invalid signature', 'expired token'])('refuse %s avant lookup et nonce (vérificateur simulé)', async (reason) => {
    mocks.verify.mockRejectedValue(new Error(reason));
    await expectRejected();
    expect(mocks.verify).toHaveBeenCalledOnce();
  });
  it.each([
    { role: 'kiosk_display', sub: 'device', app_metadata: { provider: 'kiosk' } },
    { role: 'authenticated', sub: 'device', app_metadata: { provider: 'kiosk' } },
    { role: 'authenticated', sub: 'employee' },
    { role: 'authenticated', app_metadata: { provider: 'pin' } },
  ])('refuse les claims non employés %j', async (claims) => {
    mocks.verify.mockResolvedValue(claims);
    await expectRejected();
  });
  it.each(['', 'Basic test', 'Bearer '])('refuse le header %s', async (header) => {
    await expectRejected(header);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('laisse le JWT PIN vérifié atteindre le contrôle RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { order_id: 'confirmed' }, error: null });
    const response = await invoke('Bearer test', false);
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('complete_order_with_payment_v28', expect.any(Object));
  });
});
