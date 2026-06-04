// apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx
//
// 2026-06-01 — D19 channel-uniqueness audit for usePromotionsRealtime.
//
// Mirrors `kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx`. Asserts that
// StrictMode double-mounting yields TWO distinct Supabase channel names. A
// regression (body-level `useMemo` UUID) would yield a single shared name
// across both mounts, where the second mount's `.on()` attaches to the
// still-subscribed channel from the first mount (`removeChannel` is async),
// silently dropping later events.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const channelSpy = vi.fn();

vi.mock('@/lib/supabase', () => {
  const onMock = vi.fn().mockReturnThis();
  const subscribeMock = vi.fn().mockReturnThis();
  return {
    supabase: {
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

import { usePromotionsRealtime } from '../hooks/usePromotionsRealtime';

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('usePromotionsRealtime — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => usePromotionsRealtime(), {
      wrapper: makeWrapper(true),
    });

    expect(channelSpy).toHaveBeenCalledTimes(2);

    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);

    expect(first).toMatch(/^promotions-changes-/);
    expect(second).toMatch(/^promotions-changes-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel', () => {
    renderHook(() => usePromotionsRealtime(), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(
      /^promotions-changes-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
