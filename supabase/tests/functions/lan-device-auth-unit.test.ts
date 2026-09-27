import { beforeEach, describe, it, expect, vi } from 'vitest';
const { rpc, session, limit } = vi.hoisted(() => ({
  rpc: vi.fn(),
  session: vi.fn(),
  limit: vi.fn(),
}));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: vi.fn() }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ rpc }) }));
vi.mock('../../functions/_shared/session-auth.ts', () => ({
  requireSession: session,
  hashSessionToken: async (s: string) => 'hash:' + s,
}));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: limit,
  getClientIp: () => '127.0.0.1',
}));
import { handleLanDevice } from '../../functions/lan-device-access/index';
const id = '11111111-1111-4111-8111-111111111111';
const secret = 'a'.repeat(64);
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://example.test', { method: 'POST', headers, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  limit.mockResolvedValue({ allowed: true });
  session.mockResolvedValue(new Response(null, { status: 401 }));
  rpc.mockResolvedValue({ data: { id, code: 'VERIFIED' }, error: null });
});
describe('LAN device API', () => {
  it.each(['list', 'issue', 'permissions', 'revoke'])(
    'requires a session for %s',
    async (action) => {
      expect(
        (await handleLanDevice(request({ action, device_id: id, permissions: [] }))).status,
      ).toBe(401);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it('uses the verified manager identity and honors database denial', async () => {
    session.mockResolvedValue({ userId: 'verified' });
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect(
      (await handleLanDevice(request({ action: 'issue', device_id: id, actor_id: 'forged' })))
        .status,
    ).toBe(403);
    expect(rpc).toHaveBeenCalledWith(
      'manage_lan_device_v1',
      expect.objectContaining({ p_actor_id: 'verified' }),
    );
  });
  it('refuses body-only secrets', async () => {
    expect(
      (await handleLanDevice(request({ action: 'pair', secret, pairing_code: 'a'.repeat(16) })))
        .status,
    ).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('hashes the secret and code before the database boundary', async () => {
    expect(
      (
        await handleLanDevice(
          request(
            { action: 'pair' },
            { 'x-lan-secret': secret, 'x-lan-pairing-code': 'a'.repeat(16) },
          ),
        )
      ).status,
    ).toBe(200);
    expect(rpc).toHaveBeenCalledWith('authenticate_lan_device_v1', {
      p_secret_hash: 'hash:' + secret,
      p_pairing_hash: 'hash:' + 'a'.repeat(16),
      p_device_id: null,
    });
  });
  it('heartbeats only the code returned by authentication', async () => {
    await handleLanDevice(
      request(
        { action: 'heartbeat', device_id: id, device_codes: ['FORGED'] },
        { 'x-lan-secret': secret },
      ),
    );
    expect(rpc).toHaveBeenLastCalledWith('update_lan_heartbeat_v3', {
      p_device_codes: ['VERIFIED'],
    });
  });
  it('never heartbeats after failed authentication', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect(
      (
        await handleLanDevice(
          request({ action: 'heartbeat', device_id: id }, { 'x-lan-secret': secret }),
        )
      ).status,
    ).toBe(401);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('allows device headers in the CORS preflight', async () => {
    const r = await handleLanDevice(new Request('https://example.test', { method: 'OPTIONS' }));
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('x-lan-secret');
    expect(rpc).not.toHaveBeenCalled();
  });
});
