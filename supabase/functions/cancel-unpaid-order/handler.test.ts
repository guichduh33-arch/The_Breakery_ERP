import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCancelUnpaid, parsePayload, type CancelDependencies } from './handler';

const id = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const body = { order_id: id, expected_updated_at: '2026-09-30T10:00:00Z',
  expected_items: [{ id }], losses: [{ id, waste_qty: 0 }], reason: 'Customer left' };
const execute = vi.fn();
const manager = vi.fn();
const actor = vi.fn();
const rateLimit = vi.fn();
const deps: CancelDependencies = { cors: () => null,
  json: (value, status = 200) => new Response(JSON.stringify(value), { status }),
  execute, manager, actor, rateLimit };
afterEach(() => vi.unstubAllGlobals());
function request(payload: unknown = body, headers: Record<string, string> = {}) {
  return new Request('https://example.invalid', { method: 'POST', body: JSON.stringify(payload),
    headers: { 'x-manager-pin': '123456', 'x-idempotency-key': key, ...headers } });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in unit tests'); }));
  actor.mockResolvedValue('cashier-auth'); manager.mockResolvedValue('manager-profile');
  rateLimit.mockResolvedValue(null); execute.mockResolvedValue({ data: { order_id: id, status: 'voided' }, error: null });
});
describe('annulation impayée — frontière EF sans réseau', () => {
  it('transmet uniquement les identités vérifiées, pertes et clé', async () => {
    const response = await handleCancelUnpaid(request({ ...body, authorized_by: 'forged', acting_auth_user_id: 'forged' }), deps);
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ p_order_id: id, p_expected_updated_at: body.expected_updated_at,
      p_expected_items: body.expected_items, p_losses: body.losses, p_reason: body.reason,
      p_authorized_by: 'manager-profile', p_acting_auth_user_id: 'cashier-auth', p_idempotency_key: key });
  });
  it('refuse un PIN fourni seulement dans le body', async () => {
    expect((await handleCancelUnpaid(request({ ...body, manager_pin: '123456' }, { 'x-manager-pin': '' }), deps)).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('refuse sans identité caissier', async () => {
    actor.mockResolvedValue(null);
    expect((await handleCancelUnpaid(request(), deps)).status).toBe(401);
    expect(manager).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('ne mute pas après blocage PIN', async () => {
    manager.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await handleCancelUnpaid(request(), deps)).status).toBe(429);
    expect(execute).not.toHaveBeenCalled();
  });
  it('exige une clé de tentative', async () => {
    expect((await handleCancelUnpaid(request(body, { 'x-idempotency-key': '' }), deps)).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([null, { ...body, losses: [{ id, waste_qty: -1 }] }, { ...body, losses: [{ id, waste_qty: 0 }, { id, waste_qty: 1 }] },
    { ...body, expected_items: [] }, { ...body, expected_updated_at: 'invalid' }])('refuse les charges invalides', (payload) => {
    expect(parsePayload(payload)).toBeNull();
  });
  it.each([['P0014', 409], ['23514', 422], ['P0003', 403], ['40P01', 503], ['XX000', 500]])('expurge erreur %s', async (code, status) => {
    execute.mockResolvedValue({ data: null, error: { code, message: 'secret database internals' } });
    const response = await handleCancelUnpaid(request(), deps);
    expect(response.status).toBe(status); expect(await response.text()).not.toContain('secret');
  });
});
