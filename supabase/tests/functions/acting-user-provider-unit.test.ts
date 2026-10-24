import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { verify, rpc } = vi.hoisted(() => ({ verify: vi.fn(), rpc: vi.fn() }));
vi.mock('https://deno.land/x/djwt@v3.0.2/mod.ts', () => ({ verify }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ rpc }) }));
import { getActingAuthUserId } from '../../functions/_shared/acting-user';
const sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const session = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const claims = () => ({ role: 'authenticated', app_metadata: { provider: 'pin' }, sub,
  session_id: session, exp: Date.now() / 1000 + 60 });
const request = (authorization = 'Bearer test') => new Request('https://example.test', { headers: { authorization } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Deno', { env: { get: () => 'test-signing-secret' } });
  verify.mockResolvedValue(claims());
  rpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.unstubAllGlobals());
describe('identité employé liée à une session active', () => {
  it.each([
    { role: 'kiosk_display', app_metadata: { provider: 'kiosk' } },
    { app_metadata: { provider: 'kiosk' } }, { app_metadata: null },
    { session_id: undefined }, { session_id: 'forged' }, { sub: 'employee' },
    { exp: undefined }, { exp: '9999999999' }, { exp: 0 }, { exp: Number.POSITIVE_INFINITY },
  ])('refuse %j sans accès SQL', async (invalid) => {
    verify.mockResolvedValue({ ...claims(), ...invalid });
    expect(await getActingAuthUserId(request())).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['', 'Basic test', 'Bearer '])('refuse le header %s sans vérification', async (header) => {
    expect(await getActingAuthUserId(request(header))).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('refuse une signature incorrecte avant SQL', async () => {
    verify.mockRejectedValue(new Error('invalid signature'));
    expect(await getActingAuthUserId(request())).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('valide la liaison sans renouveler l’activité', async () => {
    expect(await getActingAuthUserId(request())).toBe(sub);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('is_pin_session_active_v1', {
      p_session_id: session, p_auth_user_id: sub,
    });
  });
  it('refuse la session révoquée ou expirée', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await getActingAuthUserId(request())).toBeNull();
  });
  it.each([{ data: null, error: { message: 'offline' } }, { data: null, error: null }])(
    'distingue la panne du refus définitif', async (result) => {
      rpc.mockResolvedValue(result);
      expect((await getActingAuthUserId(request()) as Response).status).toBe(503);
    });
  it('conserve la panne de transport comme temporaire', async () => {
    rpc.mockRejectedValue(new Error('network'));
    expect((await getActingAuthUserId(request()) as Response).status).toBe(503);
  });
});
