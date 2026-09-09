import { beforeEach, describe, expect, it, vi } from 'vitest';

const { session, rpc, limit } = vi.hoisted(() => ({
  session: vi.fn(), rpc: vi.fn(), limit: vi.fn(),
}));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: vi.fn() }));
vi.mock('../../functions/_shared/session-auth.ts', () => ({ requireSession: session }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ rpc }) }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: limit, getClientIp: () => '127.0.0.1',
}));
import { handleChangePin } from '../../functions/auth-change-pin/index';

function request(body: unknown = { user_id: 'target' }) {
  return new Request('https://example.test/auth-change-pin', {
    method: 'POST', headers: { 'x-new-pin': '285741', 'x-current-pin': '123456' },
    body: JSON.stringify(body),
  });
}

describe('auth-change-pin — contrat transactionnel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockResolvedValue({ userId: 'actor-profile', authUserId: 'actor-auth', roleCode: 'CUSTOM' });
    limit.mockResolvedValue({ allowed: true });
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });
  it('transmet uniquement l’acteur validé par la session et les PIN des headers', async () => {
    const response = await handleChangePin(request({ user_id: 'target', actor_id: 'forged', new_pin: '000000' }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('change_user_pin_v1', {
      p_actor_id: 'actor-profile', p_user_id: 'target', p_new_pin: '285741', p_current_pin: '123456',
    });
  });
  it.each([
    ['invalid_current_pin', 401], ['active_profile_required', 401],
    ['permission_denied', 403], ['super_admin_only', 403],
    ['current_pin_required', 400], ['user_not_found', 404], ['account_locked', 429],
  ])('restitue %s sans mutation supplémentaire', async (error, status) => {
    rpc.mockResolvedValue({ data: { ok: false, error }, error: null });
    const response = await handleChangePin(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('refuse une panne RPC sans exposer le message SQL', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'private SQL' } });
    const response = await handleChangePin(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'change_pin_failed' });
  });
  it.each([null, [], { user_id: 42 }])('valide le body %j avant RPC', async (body) => {
    expect((await handleChangePin(request(body))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('refuse une session invalide avant RPC', async () => {
    session.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await handleChangePin(request())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('respecte la limite durable avant RPC', async () => {
    limit.mockResolvedValue({ allowed: false, retryAfterSec: 12 });
    const response = await handleChangePin(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect(rpc).not.toHaveBeenCalled();
  });
});
