import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../client.js', () => ({ getSupabaseClient: () => ({ functions: { invoke } }) }));
import { issueKioskJwt } from '../kioskAuth';
beforeEach(() => vi.clearAllMocks());
describe('transport des justificatifs appareil', () => {
  it('utilise le client partagé et réserve les secrets aux headers', async () => {
    invoke.mockResolvedValue({ data: { access_token: 'test' }, error: null });
    await issueKioskJwt('https://example.test', { action: 'pair' }, { secret: 'test-secret', pairingCode: 'test-code' });
    expect(invoke).toHaveBeenCalledWith('kiosk-issue-jwt', expect.objectContaining({
      body: { action: 'pair' }, headers: { 'x-kiosk-secret': 'test-secret', 'x-kiosk-pairing-code': 'test-code' },
    }));
    expect((invoke.mock.calls[0]?.[1] as { signal: unknown }).signal).toBeInstanceOf(AbortSignal);
  });
  it('propage le refus sans exposer les justificatifs', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: Response.json({ error: 'kiosk_unauthorized' }, { status: 401 }) } });
    await expect(issueKioskJwt('https://example.test', { action: 'renew', device_id: 'id' }, { secret: 'test-secret' }))
      .rejects.toMatchObject({ status: 401, details: { error: 'kiosk_unauthorized' } });
  });
});
