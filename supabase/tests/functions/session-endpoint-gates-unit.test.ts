import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ serve: vi.fn(), actor: vi.fn(), rpc: vi.fn(), admin: vi.fn(), render: vi.fn() }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: mocks.serve }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.47.10', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../../functions/_shared/acting-user.ts', () => ({ getActingAuthUserId: mocks.actor }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: mocks.admin }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1',
}));
vi.mock('../../functions/_shared/pdf-layout.ts', () => ({ initLayout: mocks.render }));
vi.mock('../../functions/_shared/pdf-templates/index.ts', () => ({ TEMPLATES: { pnl: { permission: 'reports.financial.read' } } }));
vi.mock('../../functions/_shared/pdf-templates/zreport.ts', () => ({ render: mocks.render }));
import '../../functions/generate-pdf/index';
import '../../functions/generate-zreport-pdf/index';
import { handleCancelUnpaid } from '../../functions/cancel-unpaid-order/handler';
const endpoints = mocks.serve.mock.calls.map(([handler], index) => ({
  name: ['generate-pdf', 'generate-zreport-pdf'][index], handler: handler as (req: Request) => Promise<Response>,
}));
const request = () => new Request('https://example.test', { method: 'POST', headers: {
  authorization: 'Bearer test', 'x-idempotency-key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}, body: JSON.stringify({ template: 'pnl', filename: 'proof', zreport_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Deno', { env: { get: () => 'test-only' } });
});
afterEach(() => vi.unstubAllGlobals());
describe.each(endpoints)('$name — garde avant rapport et Storage', ({ handler }) => {
  it.each([401,503])('conserve le refus %i sans accès métier', async (status) => {
    mocks.actor.mockResolvedValue(status === 401 ? null : Response.json({ error: 'session_check_unavailable' }, { status }));
    expect((await handler(request())).status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
it.each([401,503])('annulation impayée : refus session %i avant manager et RPC', async (status) => {
  const manager = vi.fn(), execute = vi.fn();
  const response = await handleCancelUnpaid(request(), { cors: () => null,
    json: (body, code = 200) => Response.json(body, { status: code }), rateLimit: async () => null,
    actor: async () => status === 401 ? null : Response.json({ error: 'session_check_unavailable' }, { status }),
    manager, execute });
  expect(response.status).toBe(status);
  expect(manager).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
