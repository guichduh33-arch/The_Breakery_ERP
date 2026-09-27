import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));
import { lanHeaders, pairLanDevice, useLanCredential } from '../lanCredential';
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useLanCredential.getState().setCredential(null);
});
describe('LAN activation credentials', () => {
  it('refuses protected requests before pairing', () => {
    expect(() => lanHeaders()).toThrow('Pair this terminal');
  });
  it('sends secrets only in headers and persists the confirmed identity', async () => {
    invoke.mockResolvedValue({
      data: { id: 'device', code: 'TABLET', device_type: 'tablet' },
      error: null,
    });
    const result = await pairLanDevice('0123456789abcdef');
    expect(invoke).toHaveBeenCalledWith('lan-device-access', {
      body: { action: 'pair' },
      headers: { 'x-lan-secret': result.secret, 'x-lan-pairing-code': '0123456789abcdef' },
    });
    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(lanHeaders()).toEqual({ 'x-lan-device-code': 'TABLET', 'x-lan-secret': result.secret });
    expect(sessionStorage.getItem('lan:pairing-pending')).toBeNull();
  });
  it('reuses the pending secret after a lost response without authorizing locally', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    await expect(pairLanDevice('0123456789abcdef')).rejects.toThrow('Activation failed');
    expect(useLanCredential.getState().credential).toBeNull();
    const firstArgs = invoke.mock.calls[0]?.[1] as { headers: Record<string, string> };
    invoke.mockResolvedValueOnce({
      data: { id: 'device', code: 'POS', device_type: 'pos' },
      error: null,
    });
    await pairLanDevice('0123456789abcdef');
    const retryArgs = invoke.mock.calls[1]?.[1] as { headers: Record<string, string> };
    expect(retryArgs.headers).toEqual(firstArgs.headers);
  });
});
