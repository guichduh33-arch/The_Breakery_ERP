import { beforeEach, describe, expect, it, vi } from 'vitest';
const { issue, values, storage } = vi.hoisted(() => {
  const values = new Map<string, string>();
  return { issue: vi.fn(), values, storage: {
    get: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => { values.set(key, value); return Promise.resolve(); }),
    remove: vi.fn((key: string) => { values.delete(key); return Promise.resolve(); }),
  } };
});
vi.mock('@breakery/supabase', () => ({ issueKioskJwt: issue, setSupabaseKioskAccessToken: vi.fn() }));
vi.mock('@breakery/utils', () => ({ safeStorage: storage, logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../supabase.js', () => ({ supabaseUrl: 'https://example.test' }));
import { pairKiosk, readKioskPairing } from '../kioskAuth';
const key = 'breakery-pos-kiosk-pair';
beforeEach(() => {
  vi.clearAllMocks(); values.clear();
  storage.set.mockImplementation((name: string, value: string) => { values.set(name, value); return Promise.resolve(); });
  issue.mockResolvedValue({ kiosk: { kiosk_id: 'device' }, access_token: 'test-token' });
});
describe('persistance de l’identité appareil', () => {
  it('refuse les anciens noms sans justificatif', async () => {
    values.set(key, JSON.stringify({ kiosk_id: 'old-name' }));
    expect(await readKioskPairing()).toBeNull();
  });
  it('conserve un secret avant la requête et le réutilise après perte réseau', async () => {
    issue.mockRejectedValueOnce(new Error('Network error'));
    await expect(pairKiosk('test-code')).rejects.toThrow('Network error');
    const pending = values.get(`${key}-pending-secret`);
    expect(pending).toMatch(/^[0-9a-f]{64}$/);
    await pairKiosk('test-code');
    expect(issue).toHaveBeenLastCalledWith('https://example.test', { action: 'pair' }, { secret: pending, pairingCode: 'test-code' });
    expect(await readKioskPairing()).toEqual({ kiosk_id: 'device', secret: pending });
    expect(values.has(`${key}-pending-secret`)).toBe(false);
  });
  it('refuse l’activation si le navigateur ne conserve pas le secret', async () => {
    storage.set.mockResolvedValue(undefined);
    await expect(pairKiosk('test-code')).rejects.toThrow('Device storage unavailable');
    expect(issue).not.toHaveBeenCalled();
  });
});
