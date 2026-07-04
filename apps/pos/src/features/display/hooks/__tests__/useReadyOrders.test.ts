// apps/pos/src/features/display/hooks/__tests__/useReadyOrders.test.ts
//
// Session 59 (16 D1.2) — useReadyOrders queries order_items directly for
// kitchen_status='ready' rows and aggregates them one-row-per-order. Proves
// the query shape (kitchen_status/is_cancelled filters) and the
// group-by-order_id aggregation (earliest ready_at wins).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const orderMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args) as unknown,
  },
}));

import { useReadyOrders, READY_ORDERS_LIMIT } from '../useReadyOrders';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  // .select().eq('kitchen_status', 'ready').eq('is_cancelled', false).order('ready_at', ...)
  eqMock.mockReturnValue({ eq: eqMock, order: orderMock });
  selectMock.mockReturnValue({ eq: eqMock });
  fromMock.mockReturnValue({ select: selectMock });
});

describe('useReadyOrders', () => {
  it('queries order_items filtered on kitchen_status=ready and is_cancelled=false', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useReadyOrders(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith('order_items');
    expect(eqMock).toHaveBeenCalledWith('kitchen_status', 'ready');
    expect(eqMock).toHaveBeenCalledWith('is_cancelled', false);
    expect(result.current.data).toEqual([]);
  });

  it('aggregates multiple ready items into one row per order (earliest ready_at wins)', async () => {
    orderMock.mockResolvedValue({
      data: [
        {
          order_id: 'o-1',
          ready_at: '2026-07-04T10:00:00.000Z',
          orders: { order_number: '1001', order_type: 'dine_in', table_number: '3' },
        },
        {
          order_id: 'o-1',
          ready_at: '2026-07-04T10:05:00.000Z',
          orders: { order_number: '1001', order_type: 'dine_in', table_number: '3' },
        },
        {
          order_id: 'o-2',
          ready_at: '2026-07-04T10:02:00.000Z',
          orders: { order_number: '1002', order_type: 'take_out', table_number: null },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useReadyOrders(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rows = result.current.data ?? [];
    expect(rows).toHaveLength(2);
    const o1 = rows.find((r) => r.order_id === 'o-1');
    expect(o1?.order_number).toBe('1001');
    expect(o1?.ready_at).toBe('2026-07-04T10:00:00.000Z'); // earliest wins.
    const o2 = rows.find((r) => r.order_id === 'o-2');
    expect(o2?.order_number).toBe('1002');
    expect(o2?.table_number).toBeNull();
  });

  it('does not fetch when disabled', () => {
    renderHook(() => useReadyOrders(false), { wrapper });
    expect(fromMock).not.toHaveBeenCalled();
  });

  // Session 59 (review finding) — unbounded ready section would overflow
  // the fixed-height customer-display screen during a rush.
  it('caps aggregated orders to READY_ORDERS_LIMIT, keeping the oldest-waiting first', async () => {
    const rowCount = READY_ORDERS_LIMIT + 3;
    const data = Array.from({ length: rowCount }, (_, i) => ({
      order_id: `o-${i}`,
      ready_at: `2026-07-04T10:${String(i).padStart(2, '0')}:00.000Z`,
      orders: { order_number: String(1000 + i), order_type: 'dine_in', table_number: null },
    }));
    orderMock.mockResolvedValue({ data, error: null });

    const { result } = renderHook(() => useReadyOrders(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rows = result.current.data ?? [];
    expect(rows).toHaveLength(READY_ORDERS_LIMIT);
    // Ascending ready_at — the oldest-waiting (earliest ready_at) orders are
    // the ones kept, not the most recent.
    expect(rows[0]?.order_id).toBe('o-0');
    expect(rows[rows.length - 1]?.order_id).toBe(`o-${READY_ORDERS_LIMIT - 1}`);
  });
});
