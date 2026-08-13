// apps/pos/src/features/kds/hooks/__tests__/useAgeTimer.test.ts
//
// P2 finding — before this test existed, `useAgeTimer` created ONE
// `setInterval` per consumer (KdsOrderCard: 1/ticket, PrepTimer: 1/item),
// even though the file header comment promised a shared tick. In a rush of
// ~10 tickets with a few items each that meant ~30-45 live intervals doing
// the identical `Date.now()` tick. This test locks down the fix: any number
// of components calling `useAgeTimer()` at the SAME `periodMs` must share a
// single underlying interval, and the visible MM:SS-per-second behaviour
// must stay unchanged.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

import { useAgeTimer } from '../useAgeTimer';

function Consumer({ id, periodMs }: { id: string; periodMs?: number }) {
  const now = useAgeTimer(periodMs);
  return <span data-testid={`now-${id}`}>{now}</span>;
}

describe('useAgeTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shares ONE setInterval across multiple consumers at the same default period', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    render(
      <>
        <Consumer id="a" />
        <Consumer id="b" />
        <Consumer id="c" />
      </>,
    );

    // 3 mounted consumers, same default 1s period → exactly 1 interval, not 3.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
  });

  it('advances every consumer in lockstep, once per second, without changing the visible tick', () => {
    render(
      <>
        <Consumer id="a" />
        <Consumer id="b" />
      </>,
    );

    const start = screen.getByTestId('now-a').textContent;
    expect(screen.getByTestId('now-b').textContent).toBe(start);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    const after = screen.getByTestId('now-a').textContent;
    expect(after).not.toBe(start);
    expect(Number(after) - Number(start)).toBe(1_000);
    // Both consumers tick together — same shared clock.
    expect(screen.getByTestId('now-b').textContent).toBe(after);
  });

  it('starts a separate interval for a distinct periodMs, but still shares it across consumers at that period', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    render(
      <>
        <Consumer id="a" periodMs={1_000} />
        <Consumer id="b" periodMs={15_000} />
        <Consumer id="c" periodMs={15_000} />
      </>,
    );

    // One interval for the 1s group, one for the 15s group — 2 total, not 3.
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);

    setIntervalSpy.mockRestore();
  });

  it('stops the interval once the last consumer at a period unmounts', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    const { unmount } = render(
      <>
        <Consumer id="solo" periodMs={42_000} />
      </>,
    );

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });
});
