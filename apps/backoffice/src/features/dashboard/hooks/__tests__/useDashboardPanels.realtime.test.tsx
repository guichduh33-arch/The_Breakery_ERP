import { createElement, StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), removeChannel: vi.fn(), names: [] as string[],
  subscriptions: [] as { filter: Record<string, string>; handler: () => void }[],
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  rpc: mock.rpc, removeChannel: mock.removeChannel,
  channel: (name: string) => {
    mock.names.push(name);
    const channel = {
      on: (_event: string, filter: Record<string, string>, handler: () => void) => {
        mock.subscriptions.push({ filter, handler });
        return channel;
      },
      subscribe: () => channel,
    };
    return channel;
  },
} }));

import { useOpenOrders } from '../useDashboardPanels.js';

function wrapper(client: QueryClient, strict = false) {
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('dashboard open orders — suppressions distantes', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks(); mock.names.length = 0; mock.subscriptions.length = 0;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => { cleanup(); client.clear(); });

  it('retire la commande et son total dès le signal privé, sans événement orders', async () => {
    mock.rpc.mockResolvedValueOnce({ data: {
      orders: [{ id: 'order-a', total: 45000 }], open_count: 1, open_total: 45000,
    }, error: null }).mockResolvedValue({ data: {
      orders: [], open_count: 0, open_total: 0,
    }, error: null });
    const { result, unmount } = renderHook(() => useOpenOrders(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data?.open_total).toBe(45000));
    expect(mock.rpc).toHaveBeenCalledWith('get_dashboard_open_orders_v2');
    const signal = mock.subscriptions.find(({ filter }) => filter.table === 'ui_invalidation_topics');
    expect(signal?.filter).toEqual({
      event: 'UPDATE', schema: 'public', table: 'ui_invalidation_topics', filter: 'topic=eq.orders',
    });
    act(() => signal?.handler());
    await waitFor(() => expect(result.current.data?.open_count).toBe(0));
    expect(result.current.data?.orders).toEqual([]);
    expect(result.current.data?.open_total).toBe(0);
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    unmount();
    expect(mock.removeChannel).toHaveBeenCalledOnce();
  });

  it('garde des canaux distincts sous StrictMode et respecte enabled', () => {
    mock.rpc.mockResolvedValue({ data: { orders: [], open_count: 0, open_total: 0 }, error: null });
    const { unmount } = renderHook(() => useOpenOrders(), { wrapper: wrapper(client, true) });
    expect(mock.names).toHaveLength(2);
    expect(new Set(mock.names).size).toBe(2);
    unmount();
    mock.names.length = 0;
    renderHook(() => useOpenOrders(false), { wrapper: wrapper(client) });
    expect(mock.names).toHaveLength(0);
  });
});
