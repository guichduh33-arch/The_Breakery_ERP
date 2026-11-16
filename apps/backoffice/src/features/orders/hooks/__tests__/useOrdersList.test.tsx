import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOrdersList } from '../useOrdersList.js';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]): unknown => rpcMock(...args) as unknown },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useOrdersList', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { lines: [], next_cursor_val: null, next_cursor_id: null, sort: 'created_at', dir: 'desc' }, error: null });
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
    // v3 : la première page part SANS curseur (spread conditionnel) — le
    // couple (p_cursor, p_cursor_id) n'apparaît qu'à partir de la page 2.
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v8', {
      p_start:   '2026-05-01',
      p_end:     '2026-05-26',
      p_filters: { status: 'completed', payment_method: 'cash' },
      p_limit:   25,
      p_sort:    'created_at',
      p_dir:     'desc',
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
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v8', expect.objectContaining({
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
    const refundMatcher: unknown = expect.objectContaining({ refund_status: 'partial' });
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v8', expect.objectContaining({
      p_filters: refundMatcher,
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
    const terminalMatcher: unknown = expect.objectContaining({ terminal_id: '8b55bce3-e1d2-4593-b3a9-ffc774f077c5' });
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v8', expect.objectContaining({
      p_filters: terminalMatcher,
    }));
  });

  it('T5 (S3-21) passes table_number filter into p_filters JSONB arg', async () => {
    const { result } = renderHook(
      () => useOrdersList({ start: '2026-05-01', end: '2026-05-31', filters: { table_number: 'T-07' } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v8', expect.objectContaining({
      p_filters: { table_number: 'T-07' },
    }));
  });

  it('T6 (S3-21) keeps paid_at and table_number, and turns missing ones into null', async () => {
    rpcMock.mockResolvedValue({
      data: {
        lines: [
          { id: 'o-1', created_at: '2026-05-15T02:00:00Z', paid_at: '2026-05-15T03:30:00Z', table_number: 'T-07' },
          { id: 'o-2', created_at: '2026-05-15T04:00:00Z' },
          { id: 'o-3', created_at: '2026-05-15T05:00:00Z', paid_at: null, table_number: '' },
        ],
        next_cursor_val: null, next_cursor_id: null, sort: 'created_at', dir: 'desc',
      },
      error: null,
    });
    const { result } = renderHook(
      () => useOrdersList({ start: '2026-05-01', end: '2026-05-31' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const lines = result.current.data?.pages[0]?.lines ?? [];
    expect(lines.map((l) => [l.paid_at, l.table_number])).toEqual([
      ['2026-05-15T03:30:00Z', 'T-07'],
      [null, null],
      [null, null],
    ]);
  });
});
