import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ serve: vi.fn(), rpc: vi.fn() }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: mocks.serve }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.47.10', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: () => Promise.resolve({ allowed: true }), getClientIp: () => '127.0.0.1',
}));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: vi.fn() }));
vi.mock('../../functions/_shared/manager-pin.ts', () => ({
  verifyManagerPin: vi.fn(), isManagerPinBlocked: vi.fn(), recordManagerPinFailure: vi.fn(), MANAGER_PIN_FAIL_WINDOW_SEC: 900,
}));
vi.mock('../../functions/_shared/permissions.ts', () => ({
  withPermissionErrors: (handler: unknown) => handler, checkPermissionForRole: vi.fn(),
}));

describe('paiement — erreurs comptables distinctes du verrouillage PIN', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.resetModules();
    vi.stubGlobal('Deno', { env: { get: () => 'test-only' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function invoke(error: { code: string; message: string } | null) {
    mocks.rpc.mockResolvedValue({ data: error ? null : { order_id: 'confirmed' }, error });
    await import('../../functions/process-payment/index.ts');
    const handler = mocks.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
    return handler(new Request('https://example.test', {
      method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'session', order_type: 'take_out',
        items: [{ product_id: 'product', quantity: 1, unit_price: 100 }], payment: { method: 'card', amount: 100 } }),
    }));
  }

  it.each([
    ['period_undefined: no fiscal period covers 2026-09-29', 'fiscal_period_undefined', 409],
    ['period_locked: date 2026-09-29 falls in closed period', 'fiscal_period_closed', 409],
    ['period_locked: date 2026-09-29 falls in locked period', 'fiscal_period_closed', 409],
    ['account_locked', 'account_locked', 403],
    ['unknown internal SQL detail', 'internal_error', 500],
    ['not_period_locked: internal detail', 'internal_error', 500],
  ])('classe %s sans exposer le détail SQL', async (message, code, status) => {
    const response = await invoke({ code: 'P0004', message });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it('préserve le paiement réussi', async () => {
    const response = await invoke(null);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ order_id: 'confirmed' });
  });
});
