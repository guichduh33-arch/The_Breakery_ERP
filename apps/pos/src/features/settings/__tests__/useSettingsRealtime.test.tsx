// apps/pos/src/features/settings/__tests__/useSettingsRealtime.test.tsx
//
// Settings §6.C (ADR-006 décision 4) — audit of the settings realtime hook.
// Mirrors useKdsRealtime.uniqueChannel.test.tsx (D19) : StrictMode
// double-mounting must yield TWO distinct channel names, a postgres_changes
// event must invalidate the matching settings queries, a SUBSCRIBED
// transition must invalidate everything (missed-events catch-up), and
// `enabled: false` must not open a channel at all.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const channelSpy = vi.fn();

// Captures each postgres_changes handler by table name, and the subscribe
// callback, so tests can fire them and assert the invalidations.
const handlersRef: { current: Map<string, (payload: unknown) => void> } = {
  current: new Map(),
};
const subscribeCbRef: { current: ((status: string) => void) | undefined } = {
  current: undefined,
};

vi.mock('@/lib/supabase', () => {
  const makeChannel = () => {
    const chan = {
      on: vi.fn(
        (
          _event: unknown,
          filter: { table?: string },
          handler: (payload: unknown) => void,
        ) => {
          handlersRef.current.set(filter?.table ?? 'unknown', handler);
          return chan;
        },
      ),
      subscribe: vi.fn((cb?: (status: string) => void) => {
        subscribeCbRef.current = cb;
        return chan;
      }),
    };
    return chan;
  };
  return {
    supabase: {
      channel: (name: string) => {
        channelSpy(name);
        return makeChannel();
      },
      removeChannel: vi.fn(),
    },
  };
});

import { useSettingsRealtime } from '../hooks/useSettingsRealtime';

function makeWrapper(strict: boolean, qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useSettingsRealtime — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
    handlersRef.current = new Map();
    subscribeCbRef.current = undefined;
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useSettingsRealtime(true), { wrapper: makeWrapper(true) });

    expect(channelSpy).toHaveBeenCalledTimes(2);
    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);
    expect(first).toMatch(/^settings-realtime-/);
    expect(second).toMatch(/^settings-realtime-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel with a UUID suffix', () => {
    renderHook(() => useSettingsRealtime(true), { wrapper: makeWrapper(false) });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(
      /^settings-realtime-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('enabled: false opens no channel', () => {
    renderHook(() => useSettingsRealtime(false), { wrapper: makeWrapper(false) });
    expect(channelSpy).not.toHaveBeenCalled();
  });
});

describe('useSettingsRealtime — query invalidation', () => {
  beforeEach(() => {
    channelSpy.mockClear();
    handlersRef.current = new Map();
    subscribeCbRef.current = undefined;
  });

  function mountWithSpy() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useSettingsRealtime(true), { wrapper: makeWrapper(false, qc) });
    return invalidateSpy;
  }

  it('a business_config event invalidates the business_config-backed keys only', () => {
    const invalidateSpy = mountWithSpy();
    const handler = handlersRef.current.get('business_config');
    expect(handler).toBeDefined();
    handler?.({});

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['business-config'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kds_config'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pos-presets'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['receipt-template'] });
  });

  it('a receipt_templates event invalidates the receipt-template key only', () => {
    const invalidateSpy = mountWithSpy();
    const handler = handlersRef.current.get('receipt_templates');
    expect(handler).toBeDefined();
    handler?.({});

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['receipt-template'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['business-config'] });
  });

  it('a SUBSCRIBED transition invalidates every settings key (missed-events catch-up)', () => {
    const invalidateSpy = mountWithSpy();
    expect(subscribeCbRef.current).toBeDefined();
    subscribeCbRef.current?.('SUBSCRIBED');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['business-config'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kds_config'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pos-presets'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['receipt-template'] });
  });

  it('a non-SUBSCRIBED status invalidates nothing', () => {
    const invalidateSpy = mountWithSpy();
    subscribeCbRef.current?.('CHANNEL_ERROR');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
