// apps/pos/src/features/stock/__tests__/usePOSStockProducts.test.ts
//
// POS display-stock isolation — usePOSStockProducts now reads the vitrine
// counter via the embedded display_stock(quantity) and filters is_display_item.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// --- supabase mock (same style as POSStockView.test.tsx) ---
const eqMock = vi.fn();
const isMock = vi.fn();
const orderMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { usePOSStockProducts } from '../hooks/usePOSStockProducts';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Build a chainable thenable query builder: from().select().eq().eq().is().order()
  const result = {
    data: [
      {
        id: 'p1',
        sku: 'SKU-1',
        name: 'Croissant',
        unit: 'pcs',
        image_url: null,
        min_stock_threshold: 2,
        retail_price: 25_000,
        category_id: 'c1',
        display_stock: { quantity: 7 },
        category: { id: 'c1', name: 'Pastry', slug: 'pastry' },
      },
    ],
    error: null,
  };
  orderMock.mockResolvedValue(result);
  isMock.mockReturnValue({ order: orderMock });
  // two .eq() calls chain (is_active + is_display_item)
  eqMock.mockReturnValue({ eq: eqMock, is: isMock });
  selectMock.mockReturnValue({ eq: eqMock });
  fromMock.mockReturnValue({ select: selectMock });
});

describe('usePOSStockProducts', () => {
  it('maps display_stock from the embedded object and filters is_display_item', async () => {
    const { result } = renderHook(() => usePOSStockProducts(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rows = result.current.data!;
    expect(rows).toHaveLength(1);
    expect(rows[0].display_stock).toBe(7);
    expect(rows[0].name).toBe('Croissant');
    expect(rows[0].category_name).toBe('Pastry');

    // SELECT must request the embedded display_stock(quantity)
    expect(selectMock).toHaveBeenCalledWith(expect.stringContaining('display_stock(quantity)'));
    // and must NOT select current_stock anymore
    expect(selectMock.mock.calls[0][0]).not.toContain('current_stock');
    // .eq('is_display_item', true) must be part of the query chain
    expect(eqMock).toHaveBeenCalledWith('is_display_item', true);
  });

  it('defaults display_stock to 0 when the embed is null', async () => {
    orderMock.mockResolvedValue({
      data: [
        {
          id: 'p2',
          sku: 'SKU-2',
          name: 'Baguette',
          unit: 'pcs',
          image_url: null,
          min_stock_threshold: 0,
          retail_price: 10_000,
          category_id: 'c1',
          display_stock: null,
          category: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePOSStockProducts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].display_stock).toBe(0);
    expect(result.current.data![0].category_name).toBe('Uncategorized');
  });
});
