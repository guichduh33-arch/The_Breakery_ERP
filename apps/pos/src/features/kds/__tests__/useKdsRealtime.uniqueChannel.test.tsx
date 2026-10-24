// apps/pos/src/features/kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx
//
// Session 13 / Phase 4.B — D19 channel-uniqueness audit for useKdsRealtime.
//
// Mirrors `useDisplayRealtime.uniqueChannel.test.ts` (Phase 4.C). Asserts
// that StrictMode double-mounting yields TWO distinct Supabase channel
// names. A regression would yield channel-name collisions, where the
// second mount's `.on()` attaches to the still-subscribed channel from the
// first mount (`removeChannel` is async), silently dropping later events.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const channelSpy = vi.fn();
// Session 59 review (finding 1) — capture the postgres_changes callback so a
// test can fire it and assert both ['kds', station] AND
// ['kds-served', station] get invalidated (the recall strip's cache).
// A ref object (rather than a reassigned `let`) avoids TS narrowing the
// captured-closure variable to `undefined` across the intervening
// renderHook() call.
const handlerRef: { current: ((payload: unknown) => void) | undefined } = { current: undefined };
const signalRef: { current: ((payload: unknown) => void) | undefined } = { current: undefined };

vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      channel: (name: string) => {
        channelSpy(name);
        const channel = {
          on: vi.fn((_event: unknown, filter: { table?: string }, handler: (payload: unknown) => void) => {
            if (filter.table === 'order_items') handlerRef.current = handler;
            if (filter.table === 'ui_invalidation_topics') signalRef.current = handler;
            return channel;
          }),
          subscribe: vi.fn().mockReturnThis(),
        };
        return channel;
      },
      removeChannel: vi.fn(),
    },
  };
});

import { useKdsRealtime } from '../hooks/useKdsRealtime';

function fireCapturedHandler(payload: unknown): void {
  const handler = handlerRef.current;
  if (!handler) {
    throw new Error('useKdsRealtime — postgres_changes handler was not captured by the mock');
  }
  handler(payload);
}

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useKdsRealtime — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useKdsRealtime('kitchen'), {
      wrapper: makeWrapper(true),
    });

    // StrictMode mounts the effect twice in dev. Each mount opens a
    // fresh channel with its own UUID suffix.
    expect(channelSpy).toHaveBeenCalledTimes(2);

    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);

    expect(first).toMatch(/^kds-kitchen-/);
    expect(second).toMatch(/^kds-kitchen-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel for a given (station)', () => {
    renderHook(() => useKdsRealtime('barista'), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(/^kds-barista-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // Session 59 review (finding 1) — a postgres_changes event must refresh
  // BOTH the main board query AND the recall strip's, or "Recently served"
  // lags up to 30s (its refetchInterval) behind a Mark Served / recall.
  it('invalidates both ["kds", station] and ["kds-served", station] on a postgres_changes event', () => {
    handlerRef.current = undefined;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    renderHook(() => useKdsRealtime('kitchen'), { wrapper });

    expect(handlerRef.current).toBeDefined();
    fireCapturedHandler({});

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kds', 'kitchen'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kds-served', 'kitchen'] });
  });
  it('rafraîchit sur signal privé sans émettre de faux événement cuisine LAN', () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onEvent = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    renderHook(() => useKdsRealtime('kitchen', { onEvent }), { wrapper });
    expect(signalRef.current).toBeDefined(); signalRef.current?.({});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['kds','kitchen'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['kds-served','kitchen'] });
    expect(onEvent).not.toHaveBeenCalled();
  });
});
