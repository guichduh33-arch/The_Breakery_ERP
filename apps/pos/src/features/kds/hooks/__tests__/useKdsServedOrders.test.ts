// apps/pos/src/features/kds/hooks/__tests__/useKdsServedOrders.test.ts
//
// Session 59 (04 D1.1 #2) — useKdsServedOrders queries order_items for
// kitchen_status='served' within the recall window and dedupes to one row
// per order_id (the served_at-DESC sort means "first seen" = most recent).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const orderMock = vi.fn();
const gteMock = vi.fn();
const eqMock = vi.fn();
const orMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args) as unknown,
  },
}));

import { useKdsServedOrders } from '../useKdsServedOrders';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  // .select().or(...).eq('kitchen_status', 'served').gte('served_at', ...).order(...)
  gteMock.mockReturnValue({ order: orderMock });
  eqMock.mockReturnValue({ gte: gteMock });
  orMock.mockReturnValue({ eq: eqMock });
  selectMock.mockReturnValue({ or: orMock });
  fromMock.mockReturnValue({ select: selectMock });
});

describe('useKdsServedOrders', () => {
  it('queries order_items filtered on kitchen_status=served since the recall window', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useKdsServedOrders('kitchen'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith('order_items');
    expect(eqMock).toHaveBeenCalledWith('kitchen_status', 'served');
    expect(gteMock).toHaveBeenCalledWith('served_at', expect.any(String));
    expect(result.current.data).toEqual([]);
  });

  it('dedupes multiple served items into one row per order (most recent served_at wins)', async () => {
    orderMock.mockResolvedValue({
      data: [
        {
          order_id: 'o-1',
          served_at: '2026-07-04T10:05:00.000Z',
          orders: { order_number: '#A-101' },
        },
        {
          order_id: 'o-1',
          served_at: '2026-07-04T10:00:00.000Z',
          orders: { order_number: '#A-101' },
        },
        {
          order_id: 'o-2',
          served_at: '2026-07-04T10:02:00.000Z',
          orders: { order_number: '#A-102' },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useKdsServedOrders('kitchen'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rows = result.current.data ?? [];
    expect(rows).toHaveLength(2);
    const o1 = rows.find((r) => r.order_id === 'o-1');
    expect(o1?.order_number).toBe('#A-101');
    expect(o1?.served_at).toBe('2026-07-04T10:05:00.000Z'); // first row (DESC sort) wins.
    const o2 = rows.find((r) => r.order_id === 'o-2');
    expect(o2?.order_number).toBe('#A-102');
  });
});
