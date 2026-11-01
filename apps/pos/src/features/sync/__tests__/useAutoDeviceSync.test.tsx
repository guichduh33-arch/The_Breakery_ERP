import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { useAutoDeviceSync } from '../useAutoDeviceSync';

const sync = vi.hoisted(() => vi.fn().mockResolvedValue('success'));
vi.mock('../deviceSync', () => ({ syncDeviceData: sync }));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  sync.mockClear();
  useCloudStatusStore.setState({ cloudOnline: true });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('automatic device sync', () => {
  it('rafraîchit à la reprise puis toutes les 30 secondes, et nettoie son timer', async () => {
    const { unmount } = renderHook(() => useAutoDeviceSync(true), { wrapper });
    expect(sync).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(29_999));
    expect(sync).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(sync).toHaveBeenCalledTimes(2);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('suspend les lectures en arrière-plan et rafraîchit au retour sans doublon focus', async () => {
    renderHook(() => useAutoDeviceSync(true), { wrapper });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(sync).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('suspend les lectures cloud et rattrape la reconnexion', async () => {
    useCloudStatusStore.setState({ cloudOnline: false });
    renderHook(() => useAutoDeviceSync(true), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(sync).not.toHaveBeenCalled();
    act(() => useCloudStatusStore.setState({ cloudOnline: true }));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('ne synchronise pas une session qui n’est pas prête', async () => {
    renderHook(() => useAutoDeviceSync(false), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(sync).not.toHaveBeenCalled();
  });
});
