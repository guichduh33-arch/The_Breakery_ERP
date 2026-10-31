import { beforeEach, expect, it, vi } from 'vitest';
import { createElement, StrictMode, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => {
  const events: { filter: Record<string, unknown>; handler: () => void }[] = [];
  const state: { subscribed: ((status: string) => void) | null } = { subscribed: null };
  const channels: unknown[] = [];
  return { names: vi.fn<(name: string) => void>(), remove: vi.fn<(channel: unknown) => void>(), events, state, channels };
});
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  channel: (name: string) => {
    mocks.names(name);
    const channel = {
      on: (_kind: unknown, filter: Record<string, unknown>, handler: () => void): unknown => {
        mocks.events.push({ filter, handler }); return channel;
      },
      subscribe: (callback: (status: string) => void): unknown => { mocks.state.subscribed = callback; return channel; },
    };
    mocks.channels.push(channel);
    return channel;
  },
  removeChannel: (channel: unknown) => { mocks.remove(channel); return Promise.resolve('ok'); },
} }));
import { useProductSalesVisibilityRealtime } from '../hooks/useProductSalesVisibilityRealtime.js';
function mount(enabled = true, strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
  return { ...renderHook(() => useProductSalesVisibilityRealtime(enabled), { wrapper }), client };
}
function seed(client: QueryClient) {
  client.setQueryData(['sales-by-product', 'current'], { secret: 'old summary' });
  client.setQueryData(['sales-by-product', 'previous'], { secret: 'old comparison' });
  client.setQueryData(['product-sales-lines', 'p'], { secret: 'old drawer' });
  client.setQueryData(['cash-totals'], { total: 100 });
}
function expectCleared(client: QueryClient) {
  expect(client.getQueryData(['sales-by-product', 'current'])).toBeUndefined();
  expect(client.getQueryData(['sales-by-product', 'previous'])).toBeUndefined();
  expect(client.getQueryData(['product-sales-lines', 'p'])).toBeUndefined();
  expect(client.getQueryData(['cash-totals'])).toEqual({ total: 100 });
}
beforeEach(() => { mocks.names.mockClear(); mocks.remove.mockClear(); mocks.events.length = 0; mocks.channels.length = 0; mocks.state.subscribed = null; });
it('clears cached product reports and drilldown on an opaque orders signal, preserving cash totals', () => {
  const { client } = mount();
  seed(client);
  expect(mocks.events).toHaveLength(1);
  expect(mocks.events[0]?.filter).toEqual({ event: 'UPDATE', schema: 'public', table: 'ui_invalidation_topics', filter: 'topic=eq.orders' });
  mocks.events[0]?.handler();
  expectCleared(client);
});
it('clears on join and rejoin to catch release changes missed while disconnected', () => {
  const { client } = mount();
  seed(client);
  mocks.state.subscribed?.('SUBSCRIBED');
  expectCleared(client);
  seed(client);
  mocks.state.subscribed?.('CHANNEL_ERROR');
  expect(client.getQueryData(['sales-by-product', 'current'])).toBeDefined();
  mocks.state.subscribed?.('SUBSCRIBED');
  expectCleared(client);
});
it('uses distinct channels per StrictMode mount and cleans up each channel', () => {
  const { unmount } = mount(true, true);
  expect(mocks.names).toHaveBeenCalledTimes(2);
  expect(mocks.names.mock.calls[0]?.[0]).not.toBe(mocks.names.mock.calls[1]?.[0]);
  expect(mocks.names.mock.calls[0]?.[0]).toMatch(/^product-sales-visibility-/);
  unmount();
  expect(mocks.remove).toHaveBeenCalledTimes(2);
  expect(mocks.remove).toHaveBeenCalledWith(mocks.channels[0]);
  expect(mocks.remove).toHaveBeenCalledWith(mocks.channels[1]);
});
it('does not join without an authenticated profile', () => {
  mount(false);
  expect(mocks.names).not.toHaveBeenCalled();
});
