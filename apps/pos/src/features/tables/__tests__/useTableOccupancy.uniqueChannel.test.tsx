// apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx
//
// 2026-06-01 — D19 channel-uniqueness audit for useTableOccupancy.
//
// Mirrors `kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx`. Asserts that
// StrictMode double-mounting yields TWO distinct Supabase channel names. The
// hook also runs a `useQuery(fetchOccupied)`; the supabase mock resolves the
// `from(...).select(...).not(...).not(...)` chain to an empty result so the
// query never throws, and the realtime `.channel()` call still fires in the
// effect under both StrictMode mounts.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const channelSpy = vi.fn();

vi.mock('@/lib/supabase', () => {
  const onMock = vi.fn().mockReturnThis();
  const subscribeMock = vi.fn().mockReturnThis();
  // fetchOccupied calls: from('orders').select(...).not(...).not(...) → awaited.
  const okResult = Promise.resolve({ data: [], error: null });
  const queryChain = {
    select: () => queryChain,
    not: () => queryChain,
    then: (...args: unknown[]) =>
      okResult.then(...(args as Parameters<typeof okResult.then>)),
  };
  return {
    supabase: {
      from: () => queryChain,
      channel: (name: string) => {
        channelSpy(name);
        return {
          on: onMock,
          subscribe: subscribeMock,
        };
      },
      removeChannel: vi.fn(),
    },
  };
});

import { useTableOccupancy } from '../hooks/useTableOccupancy';

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useTableOccupancy — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useTableOccupancy(), {
      wrapper: makeWrapper(true),
    });

    expect(channelSpy).toHaveBeenCalledTimes(2);

    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);

    expect(first).toMatch(/^table_occupancy_realtime-/);
    expect(second).toMatch(/^table_occupancy_realtime-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel', () => {
    renderHook(() => useTableOccupancy(), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(
      /^table_occupancy_realtime-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
