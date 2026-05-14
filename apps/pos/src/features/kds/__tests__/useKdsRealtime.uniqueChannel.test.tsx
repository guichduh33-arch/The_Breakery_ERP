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

import { useKdsRealtime } from '../hooks/useKdsRealtime';

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
});
