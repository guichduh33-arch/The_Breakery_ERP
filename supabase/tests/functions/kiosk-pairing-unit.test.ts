import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, session, limit, sign } = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn(), limit: vi.fn(), sign: vi.fn() }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: vi.fn() }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ rpc }) }));
vi.mock('../../functions/_shared/session-auth.ts', () => ({
  requireSession: session,
  hashSessionToken: async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, '0')).join(''),
}));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({ checkRateLimitDurable: limit, getClientIp: () => '192.0.2.1' }));
vi.mock('../../functions/_shared/jwt.ts', () => ({ getJwtSecret: () => 'test-key', signJwt: sign }));
import { handleKiosk } from '../../functions/kiosk-issue-jwt/index';

const secret = 'a'.repeat(64);
const id = '00000000-0000-4000-8000-000000000001';
const request = (body: unknown, headers: Record<string, string> = {}) => new Request('https://example.test/', {
  method: 'POST', headers, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  limit.mockResolvedValue({ allowed: true });
  session.mockResolvedValue(new Response(null, { status: 401 }));
  rpc.mockResolvedValue({ data: { id, label: 'Front' }, error: null });
  sign.mockResolvedValue('signed-token');
});
describe('appairage écran', () => {
  it.each([null, [], { kiosk_id: 'free-name', scope: 'display' }, { action: 'renew', device_id: id },
    { action: 'pair', secret, pairing_code: 'abcdef0123456789' }])('refuse l’ancien protocole et les secrets en body : %j', async (body) => {
    expect((await handleKiosk(request(body))).status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
  });
  it.each(['create', 'list', 'revoke'])('exige une session pour %s', async (action) => {
    expect((await handleKiosk(request({ action, label: 'Front', device_id: id }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('utilise l’acteur de la session et respecte le refus de permission serveur', async () => {
    session.mockResolvedValue({ userId: 'verified-profile' });
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect((await handleKiosk(request({ action: 'create', label: 'Front', actor_id: 'forged' }))).status).toBe(403);
    expect(rpc).toHaveBeenCalledWith('manage_display_device_v1', expect.objectContaining({ p_actor_id: 'verified-profile' }));
  });
  it('émet exclusivement le rôle écran après authentification du secret', async () => {
    const response = await handleKiosk(request({ action: 'pair', scope: 'tablet' }, {
      'x-kiosk-secret': secret, 'x-kiosk-pairing-code': 'abcd-ef01-2345-6789',
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('authenticate_display_device_v1', {
      p_device_id: null, p_secret_hash: expect.stringMatching(/^[0-9a-f]{64}$/), p_pairing_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(rpc.mock.calls[0][1].p_secret_hash).not.toBe(secret);
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({ role: 'kiosk_display', sub: id,
      app_metadata: { provider: 'kiosk', scope: 'display' } }), 'test-key');
  });
  it('ne signe rien si le registre refuse le renouvellement', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect((await handleKiosk(request({ action: 'renew', device_id: id }, { 'x-kiosk-secret': secret }))).status).toBe(401);
    expect(sign).not.toHaveBeenCalled();
  });
  it('autorise les headers d’appairage au preflight', async () => {
    const response = await handleKiosk(new Request('https://example.test/', { method: 'OPTIONS' }));
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-kiosk-secret');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-kiosk-pairing-code');
    expect(rpc).not.toHaveBeenCalled();
  });
});
