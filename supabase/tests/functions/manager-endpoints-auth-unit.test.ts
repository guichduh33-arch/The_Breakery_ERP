import { beforeEach, describe, expect, it, vi } from 'vitest';

// Contrôle du câblage des refus ; signature JWT et verrouillage DB simulés.
const { serve, actor, manager, blocked, failure, limit, rpc, from } = vi.hoisted(() => ({
  serve: vi.fn(), actor: vi.fn(), manager: vi.fn(), blocked: vi.fn(),
  failure: vi.fn(), limit: vi.fn(), rpc: vi.fn(), from: vi.fn(),
}));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve }));
vi.mock('../../functions/_shared/cors.ts', () => ({
  corsHeaders: {}, handleCors: () => null,
  jsonResponse: (body: unknown, status = 200) => Response.json(body, { status }),
}));
vi.mock('../../functions/_shared/acting-user.ts', () => ({ getActingAuthUserId: actor }));
vi.mock('../../functions/_shared/manager-pin.ts', () => ({
  verifyManagerPin: manager, isManagerPinBlocked: blocked,
  recordManagerPinFailure: failure, MANAGER_PIN_FAIL_WINDOW_SEC: 900,
}));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: limit, getClientIp: () => '192.0.2.1',
}));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => ({ rpc, from }),
}));
import '../../functions/verify-manager-pin/index';
import '../../functions/refund-order/index';
import '../../functions/void-order/index';
import '../../functions/cancel-item/index';

const names = ['verify-manager-pin', 'refund-order', 'void-order', 'cancel-item'];
const endpoints = serve.mock.calls.map(([handler], index) => ({
  name: names[index], handler: handler as (req: Request) => Promise<Response>,
}));
const id = '00000000-0000-4000-8000-000000000001';
function request(headers: Record<string, string> = {
  authorization: 'Bearer test-token', 'x-manager-pin': '123456',
}) {
  return new Request('https://example.test/', {
    method: 'POST', headers, body: JSON.stringify({
      order_id: id, order_item_id: id, reason: 'Test refusal',
      lines: [{ order_item_id: id, qty: 1 }], tenders: [{ method: 'cash', amount: 1 }],
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  limit.mockResolvedValue({ allowed: true });
  actor.mockResolvedValue('test-actor');
  blocked.mockResolvedValue(false);
  manager.mockResolvedValue({ ok: false, reason: 'no_match' });
  failure.mockResolvedValue({ blocked: false, retryAfterSec: 0 });
});

describe.each(endpoints)('$name — refus avant toute mutation métier', ({ handler }) => {
  it('refuse une requête sans authentification', async () => {
    expect((await handler(request({ 'x-manager-pin': '123456' }))).status).toBe(401);
    expect(manager).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it('respecte le refus du vérificateur JWT', async () => {
    actor.mockResolvedValue(null);
    expect((await handler(request())).status).toBe(401);
    expect(manager).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it('refuse un PIN incorrect et comptabilise cet échec', async () => {
    expect((await handler(request())).status).toBe(401);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it('respecte le verrouillage avant de vérifier le PIN', async () => {
    blocked.mockResolvedValue(true);
    const response = await handler(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('900');
    expect(manager).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
