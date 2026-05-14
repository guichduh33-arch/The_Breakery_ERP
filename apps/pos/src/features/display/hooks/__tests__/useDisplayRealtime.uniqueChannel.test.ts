// apps/pos/src/features/display/hooks/__tests__/useDisplayRealtime.uniqueChannel.test.ts
//
// Session 13 / Phase 4.C — D-4C-3 acceptance test (D19 Wave 1 hotfix).
//
// Asserts that mounting `useDisplayRealtime` twice (as StrictMode does in
// dev) yields two *distinct* channel names. Without the per-effect-mount
// UUID, the second mount's .on() runs against the still-subscribed
// channel from the first mount and the realtime listener silently breaks.

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

import { useDisplayRealtime } from '../useDisplayRealtime';

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useDisplayRealtime — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useDisplayRealtime('screen-front-1'), {
      wrapper: makeWrapper(true),
    });

    // StrictMode mounts the effect twice in dev. Each mount opens a
    // new channel with its own UUID suffix.
    expect(channelSpy).toHaveBeenCalledTimes(2);

    const [firstCall, secondCall] = channelSpy.mock.calls.map((c) => c[0] as string);

    // Both channels share the `display-{screenId}-` prefix...
    expect(firstCall).toMatch(/^display-screen-front-1-/);
    expect(secondCall).toMatch(/^display-screen-front-1-/);

    // ...but the per-mount UUID suffix differs.
    expect(firstCall).not.toBe(secondCall);
  });

  it('non-StrictMode mount produces 1 channel for a given (screenId)', () => {
    renderHook(() => useDisplayRealtime('screen-front-2'), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(/^display-screen-front-2-/);
  });
});
