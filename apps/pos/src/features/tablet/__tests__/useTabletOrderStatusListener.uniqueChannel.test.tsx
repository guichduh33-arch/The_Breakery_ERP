// apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx
//
// 2026-06-01 — D19 channel-uniqueness audit for useTabletOrderStatusListener.
//
// Mirrors `kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx`. Asserts that
// StrictMode double-mounting yields TWO distinct Supabase channel names. The
// effect early-returns when there is no authenticated user, so `useAuthStore`
// is mocked to surface a non-null `user.id`; `sonner` is mocked so the toast
// import resolves cleanly.

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

// useAuthStore((s) => s.user?.id) must return a non-null id, else the effect
// early-returns and no channel is ever opened.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'tablet-user-1' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useTabletOrderStatusListener } from '../hooks/useTabletOrderStatusListener';

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useTabletOrderStatusListener — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useTabletOrderStatusListener(), {
      wrapper: makeWrapper(true),
    });

    expect(channelSpy).toHaveBeenCalledTimes(2);

    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);

    expect(first).toMatch(/^tablet-order-status-/);
    expect(second).toMatch(/^tablet-order-status-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel', () => {
    renderHook(() => useTabletOrderStatusListener(), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(
      /^tablet-order-status-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
