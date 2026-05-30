import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOrdersList } from '../useOrdersList.js';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useOrdersList', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { lines: [], next_cursor: null }, error: null });
  });

  it('T1 maps params to RPC args correctly', async () => {
    const { result } = renderHook(
      () =>
        useOrdersList({
          start: '2026-05-01',
          end: '2026-05-26',
          filters: { status: 'completed', payment_method: 'cash' },
          limit: 25,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v2', {
      p_start:   '2026-05-01',
      p_end:     '2026-05-26',
      p_filters: { status: 'completed', payment_method: 'cash' },
      p_limit:   25,
      p_cursor:  null,
    });
  });

  it('T2 strips empty filter values', async () => {
    const { result } = renderHook(
      () =>
        useOrdersList({
          start: '2026-05-01',
          end: '2026-05-26',
          filters: { status: '', payment_method: 'qris' },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v2', expect.objectContaining({
      p_filters: { payment_method: 'qris' },
    }));
  });

  it('T3 passes refund_status filter into p_filters JSONB arg', async () => {
    const { result } = renderHook(
      () =>
        useOrdersList({
          start: '2026-05-01',
          end: '2026-05-31',
          filters: { refund_status: 'partial' },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v2', expect.objectContaining({
      p_filters: expect.objectContaining({ refund_status: 'partial' }),
    }));
  });

  it('T4 passes terminal_id filter into p_filters JSONB arg', async () => {
    const { result } = renderHook(
      () =>
        useOrdersList({
          start: '2026-05-01',
          end: '2026-05-31',
          filters: { terminal_id: '8b55bce3-e1d2-4593-b3a9-ffc774f077c5' },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v2', expect.objectContaining({
      p_filters: expect.objectContaining({ terminal_id: '8b55bce3-e1d2-4593-b3a9-ffc774f077c5' }),
    }));
  });
});
