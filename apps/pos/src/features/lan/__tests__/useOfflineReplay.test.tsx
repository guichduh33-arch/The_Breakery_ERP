import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const replay = vi.hoisted(() => vi.fn());
vi.mock('../offlineReplay', () => ({ replayOfflineOutbox: replay }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));

import { useOfflineReplay } from '../hooks/useOfflineReplay';
import { useAuthStore } from '@/stores/authStore';
import { useCloudStatusStore } from '../cloudStatusStore';

beforeEach(() => {
  vi.useFakeTimers();
  replay.mockReset().mockResolvedValue({ replayed: 0, failed: 0 });
  useAuthStore.setState({ isAuthenticated: true, cloudValidated: true, isLocked: false });
  useCloudStatusStore.setState({ cloudOnline: true });
});
afterEach(() => vi.useRealTimers());

describe('automatic offline replay', () => {
  it('retries with unchanged network/auth at 15/30/60 seconds, capped at 60', async () => {
    replay.mockResolvedValue({ replayed: 0, failed: 1 });
    const hook = renderHook(useOfflineReplay);
    await act(async () => { await Promise.resolve(); });
    for (const delay of [15_000, 30_000, 60_000, 60_000]) {
      const calls = replay.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
      expect(replay).toHaveBeenCalledTimes(calls);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(replay).toHaveBeenCalledTimes(calls + 1);
    }
    replay.mockResolvedValue({ replayed: 1, failed: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    const calls = replay.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(replay).toHaveBeenCalledTimes(calls);
    hook.unmount();
  });

  it.each(['locked', 'cloud', 'auth', 'validated'])('cancels retries when %s blocks and resumes when restored', async (gate) => {
    replay.mockResolvedValue({ replayed: 0, failed: 1 });
    const hook = renderHook(useOfflineReplay);
    await act(async () => { await Promise.resolve(); });
    const change = (allowed: boolean) => {
      if (gate === 'cloud') useCloudStatusStore.setState({ cloudOnline: allowed });
      else if (gate === 'locked') useAuthStore.setState({ isLocked: !allowed });
      else if (gate === 'auth') useAuthStore.setState({ isAuthenticated: allowed });
      else useAuthStore.setState({ cloudValidated: allowed });
    };
    act(() => change(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(replay).toHaveBeenCalledTimes(1);
    replay.mockResolvedValue({ replayed: 1, failed: 0 });
    await act(async () => { change(true); await Promise.resolve(); });
    expect(replay).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('handles storage rejection and retries without another network event', async () => {
    replay.mockRejectedValueOnce(new Error('quota')).mockResolvedValue({ replayed: 1, failed: 0 });
    const hook = renderHook(useOfflineReplay);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(replay).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('keeps one drain in flight and cancels pending retries on unmount', async () => {
    let resolve!: (result: { replayed: number; failed: number }) => void;
    replay.mockReturnValue(new Promise((done) => { resolve = done; }));
    const hook = renderHook(useOfflineReplay);
    act(() => { useAuthStore.setState({ isLocked: true }); useAuthStore.setState({ isLocked: false }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(replay).toHaveBeenCalledTimes(1);
    replay.mockResolvedValue({ replayed: 0, failed: 1 });
    await act(async () => { resolve({ replayed: 0, failed: 0 }); await Promise.resolve(); });
    expect(replay).toHaveBeenCalledTimes(2);
    hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(replay).toHaveBeenCalledTimes(2);
  });
});
