import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { obtain, inject, current } = vi.hoisted(() => ({ obtain: vi.fn(), inject: vi.fn(), current: vi.fn() }));
vi.mock('@/lib/kioskAuth', () => ({ obtainKioskJwt: obtain, nextRefreshDelayMs: () => 5_000 }));
vi.mock('@breakery/supabase', () => ({ getSupabaseAccessToken: current, setSupabaseKioskAccessToken: inject }));
import { useKioskAuth } from '../useKioskAuth';
const success = { ok: true, response: { access_token: 'device-token', expires_at: 9999999999 } };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); obtain.mockResolvedValue(success); current.mockReturnValue('device-token'); });
afterEach(() => vi.useRealTimers());
describe('renouvellement appareil', () => {
  it('renouvelle automatiquement et nettoie son jeton au démontage', async () => {
    const { result, unmount } = renderHook(() => useKioskAuth());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.status).toBe('authenticated');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(obtain).toHaveBeenCalledTimes(2);
    unmount();
    expect(inject).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reprend après une panne réseau', async () => {
    obtain.mockResolvedValueOnce({ ok: false, error: { error: 'kiosk_unavailable' }, status: 503 });
    const { result, unmount } = renderHook(() => useKioskAuth());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.status).toBe('pin_fallback');
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.status).toBe('authenticated');
    unmount();
  });
  it('ne relance pas un justificatif refusé', async () => {
    obtain.mockResolvedValue({ ok: false, error: { error: 'kiosk_unauthorized' }, status: 401 });
    const { unmount } = renderHook(() => useKioskAuth());
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(60_000); });
    expect(obtain).toHaveBeenCalledTimes(1);
    unmount();
  });
  it('ignore une réponse arrivée après démontage', async () => {
    let resolve: (value: typeof success) => void = () => undefined;
    obtain.mockReturnValue(new Promise<typeof success>((done) => { resolve = done; }));
    const { unmount } = renderHook(() => useKioskAuth());
    unmount();
    await act(async () => { resolve(success); await Promise.resolve(); });
    expect(inject).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
