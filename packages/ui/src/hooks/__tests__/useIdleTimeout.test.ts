// packages/ui/src/hooks/__tests__/useIdleTimeout.test.ts
// Session 19 / Phase 3.A — Tests written first (TDD) per INDEX Step 1.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimeout } from '../useIdleTimeout.js';

describe('useIdleTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires onTimeout after timeoutMinutes idle', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMinutes: 1, onTimeout }));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(60_001); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('activity resets the timer', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMinutes: 1, onTimeout }));
    act(() => { vi.advanceTimersByTime(45_000); });
    act(() => { window.dispatchEvent(new Event('mousedown')); });
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does nothing when timeoutMinutes is 0 or falsy', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMinutes: 0, onTimeout }));
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
