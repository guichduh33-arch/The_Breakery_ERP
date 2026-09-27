import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { serve, getUser, from, rpc, env, sendEmail } = vi.hoisted(() => ({
  serve: vi.fn(), getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), env: vi.fn(), sendEmail: vi.fn(),
}));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve }));
vi.mock('../../functions/_shared/cors.ts', () => ({
  handleCors: () => null,
  jsonResponse: (body: unknown, status = 200) => Response.json(body, { status }),
}));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => ({ auth: { getUser }, from, rpc }),
}));
vi.mock('../../functions/_shared/email-provider.ts', () => ({ sendEmail }));
import '../../functions/notification-dispatch/index';
import '../../functions/lan-heartbeat-batch/index';

const [dispatch, heartbeat] = serve.mock.calls.map(([handler]) =>
  handler as (req: Request) => Promise<Response>);
const request = (headers: Record<string, string> = {}) => new Request('https://example.test/', {
  method: 'POST', headers, body: JSON.stringify({ device_codes: ['test-device'] }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Deno', { env: { get: env } });
  env.mockImplementation((name: string) => ({
    NOTIFICATION_DISPATCH_SECRET: 'test-dispatch-secret', LAN_HEARTBEAT_SECRET: 'test-hub-secret',
  })[name]);
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid token' } });
  rpc.mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('notifications — refus avant la prise du lot et tout envoi', () => {
  it.each([{}, { 'x-dispatch-secret': 'wrong' }, { authorization: 'Bearer invalid' }])(
    'refuse %j', async (headers) => {
      expect((await dispatch(request(headers))).status).toBe(401);
      expect(rpc).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );
  it.each([
    { data: false, error: null },
    { data: null, error: { message: 'Permission lookup failed' } },
  ])('refuse sans permission vérifiée : %j', async (result) => {
    getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
    rpc.mockResolvedValue(result);
    expect((await dispatch(request({ authorization: 'Bearer user-token' }))).status).toBe(401);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('has_permission', {
      p_uid: 'user', p_perm: 'notifications.send',
    });
    expect(from).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('accepte le secret serveur configuré', async () => {
    expect((await dispatch(request({ 'x-dispatch-secret': 'test-dispatch-secret' }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('pick_notifications_batch_v2', { p_limit: 50 });
  });
  it('accepte un utilisateur dont la permission est vérifiée', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect((await dispatch(request({ authorization: 'Bearer user-token' }))).status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(2, 'pick_notifications_batch_v2', { p_limit: 50 });
  });
});

describe('remontées appareils — secret serveur obligatoire', () => {
  it.each([{}, { 'x-hub-secret': 'wrong' }, { authorization: 'Bearer user-token' }])(
    'refuse %j avant toute écriture', async (headers) => {
      expect((await heartbeat(request(headers))).status).toBe(401);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it('désactive le traitement sans secret configuré', async () => {
    env.mockReturnValue(undefined);
    expect((await heartbeat(request({ 'x-hub-secret': 'test-hub-secret' }))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('accepte le secret serveur configuré', async () => {
    expect((await heartbeat(request({ 'x-hub-secret': 'test-hub-secret' }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('update_lan_heartbeat_v3', {
      p_device_codes: ['test-device'],
    });
  });
});
