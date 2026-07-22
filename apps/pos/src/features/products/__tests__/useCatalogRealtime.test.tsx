// apps/pos/src/features/products/__tests__/useCatalogRealtime.test.tsx
//
// ADR-011 décision 3 — audit of the catalog realtime hook. Mirrors
// useSettingsRealtime.test.tsx (D19) : StrictMode double-mounting must yield
// TWO distinct channel names, a postgres_changes event must invalidate the
// matching catalog queries, a SUBSCRIBED transition must invalidate
// everything (missed-events catch-up), and `enabled: false` must not open a
// channel at all.

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

import { useCatalogRealtime } from '../hooks/useCatalogRealtime';

function makeWrapper(strict: boolean, qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useCatalogRealtime — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
    handlersRef.current = new Map();
    subscribeCbRef.current = undefined;
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useCatalogRealtime(true), { wrapper: makeWrapper(true) });

    expect(channelSpy).toHaveBeenCalledTimes(2);
    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);
    expect(first).toMatch(/^catalog-realtime-/);
    expect(second).toMatch(/^catalog-realtime-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel with a UUID suffix', () => {
    renderHook(() => useCatalogRealtime(true), { wrapper: makeWrapper(false) });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(
      /^catalog-realtime-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('enabled: false opens no channel', () => {
    renderHook(() => useCatalogRealtime(false), { wrapper: makeWrapper(false) });
    expect(channelSpy).not.toHaveBeenCalled();
  });
});

describe('useCatalogRealtime — query invalidation', () => {
  beforeEach(() => {
    channelSpy.mockClear();
    handlersRef.current = new Map();
    subscribeCbRef.current = undefined;
  });

  function mountWithSpy() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useCatalogRealtime(true), { wrapper: makeWrapper(false, qc) });
    return invalidateSpy;
  }

  it('a products event invalidates the grid + variant-picker keys only', () => {
    const invalidateSpy = mountWithSpy();
    const handler = handlersRef.current.get('products');
    expect(handler).toBeDefined();
    handler?.({});

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['products'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pos-product-variants'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['categories'] });
  });

  it('a categories event invalidates the nav AND the grid (dispatch_station embed)', () => {
    const invalidateSpy = mountWithSpy();
    const handler = handlersRef.current.get('categories');
    expect(handler).toBeDefined();
    handler?.({});

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['categories'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['products'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['pos-product-variants'] });
  });

  it('a SUBSCRIBED transition invalidates every catalog key (missed-events catch-up)', () => {
    const invalidateSpy = mountWithSpy();
    expect(subscribeCbRef.current).toBeDefined();
    subscribeCbRef.current?.('SUBSCRIBED');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['products'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pos-product-variants'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['categories'] });
  });

  it('a non-SUBSCRIBED status invalidates nothing', () => {
    const invalidateSpy = mountWithSpy();
    subscribeCbRef.current?.('CHANNEL_ERROR');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
