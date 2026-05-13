// apps/pos/src/features/lan/__tests__/useLanHub.uniqueChannel.test.tsx
//
// Session 13 / Phase 5.A — D19 channel-uniqueness audit for useLanHub.
//
// Asserts that StrictMode double-mount yields TWO distinct Supabase
// channel names. A regression (mounting via component-body useMemo)
// would yield channel-name collisions where the second effect mount
// silently shares the still-subscribed channel from the first mount.
//
// Mirror : `useKdsRealtime.uniqueChannel.test.tsx` (Phase 4.B) +
//          `useDisplayRealtime.uniqueChannel.test.ts` (Phase 4.C).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const channelSpy = vi.fn();

vi.mock('@/lib/supabase', () => {
  const subscribeMock = vi.fn().mockReturnThis();
  const onMock = vi.fn().mockReturnThis();
  return {
    supabase: {
      channel: (name: string) => {
        channelSpy(name);
        return {
          on: onMock,
          subscribe: subscribeMock,
          send: vi.fn(),
        };
      },
      removeChannel: vi.fn(),
    },
  };
});

import { useLanHub } from '../hooks/useLanHub';

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useLanHub — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useLanHub({ hubDeviceId: 'hub-pos-01' }), {
      wrapper: makeWrapper(true),
    });

    expect(channelSpy).toHaveBeenCalledTimes(2);
    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);
    expect(first).toMatch(/^lan-hub-hub-pos-01-/);
    expect(second).toMatch(/^lan-hub-hub-pos-01-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel for a given hubDeviceId', () => {
    renderHook(() => useLanHub({ hubDeviceId: 'hub-pos-02' }), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(/^lan-hub-hub-pos-02-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
