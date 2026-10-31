import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ limit: vi.fn(), channel: vi.fn(), callbacks: [] as (() => void)[] }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ or: () => ({ order: () => ({ limit: mocks.limit }) }) }) }),
  channel: mocks.channel,
  removeChannel: vi.fn(),
} }));
vi.mock('@/lib/useReconnectInvalidate', () => ({ useReconnectInvalidate: vi.fn() }));
import { useHeldOrdersQuery } from '../hooks/useHeldOrdersQuery';

describe('On hold reste abonne quand la liste est fermee', () => {
  it('actualise la liste et le compteur sur reception waiter, avec un canal unique par montage', async () => {
    mocks.limit.mockResolvedValue({ data: [], error: null });
    mocks.channel.mockImplementation(() => {
      const channel = { on: vi.fn((_event, _filter, callback: () => void) => {
        mocks.callbacks.push(callback);
        return channel;
      }), subscribe: vi.fn(() => channel) };
      return channel;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const first = renderHook(() => useHeldOrdersQuery(), { wrapper });
    await waitFor(() => expect(first.result.current.data).toEqual([]));
    mocks.limit.mockResolvedValue({ data: [{ id: 'incoming-waiter', order_items: [
      { is_cancelled: false }, { is_cancelled: true },
    ] }], error: null });
    act(() => mocks.callbacks[0]!());
    await waitFor(() => expect(first.result.current.data).toEqual([{ id: 'incoming-waiter', active_items_count: 1 }]));
    first.unmount();
    const second = renderHook(() => useHeldOrdersQuery(), { wrapper });
    expect(mocks.channel.mock.calls).toHaveLength(2);
    expect(mocks.channel.mock.calls[0]![0]).not.toBe(mocks.channel.mock.calls[1]![0]);
    second.unmount();
  });
});
