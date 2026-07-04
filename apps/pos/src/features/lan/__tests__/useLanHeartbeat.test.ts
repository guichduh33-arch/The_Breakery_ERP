// apps/pos/src/features/lan/__tests__/useLanHeartbeat.test.ts
//
// Session 59 (21 D1.1) — the hook existed since S13 but had no test and no
// call-site. Asserts the tick contract that the POS/KDS/tablet shells now
// rely on: fires immediately on mount, ticks on interval, no-ops with an
// empty device code, and cleans up its interval on unmount.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args) as unknown },
}));

import { useLanHeartbeat } from '../hooks/useLanHeartbeat';

describe('useLanHeartbeat', () => {
  beforeEach(() => {
    rpcMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls update_lan_heartbeat_v1 immediately on mount with the device code', () => {
    // The hook's tick() calls supabase.rpc(...) synchronously before its first
    // `await` — renderHook's act() flush is enough, no need to await anything.
    renderHook(() => useLanHeartbeat({ deviceCode: 'POS-FRONT-01', deviceType: 'pos' }));
    expect(rpcMock).toHaveBeenCalledWith('update_lan_heartbeat_v1', {
      p_device_code: 'POS-FRONT-01',
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('ticks again after the interval elapses', async () => {
    renderHook(() => useLanHeartbeat({ deviceCode: 'KDS-KITCHEN', deviceType: 'kds' }));
    expect(rpcMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('does not call the RPC when the device code is empty (unregistered terminal)', () => {
    renderHook(() => useLanHeartbeat({ deviceCode: '', deviceType: 'tablet' }));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('stops ticking after unmount (interval cleanup)', async () => {
    const { unmount } = renderHook(() =>
      useLanHeartbeat({ deviceCode: 'TABLET-01', deviceType: 'tablet' }),
    );
    expect(rpcMock).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('does not call the RPC when disabled', () => {
    renderHook(() =>
      useLanHeartbeat({ deviceCode: 'POS-FRONT-01', deviceType: 'pos', enabled: false }),
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
