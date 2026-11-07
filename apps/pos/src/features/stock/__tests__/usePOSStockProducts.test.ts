import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const api = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: api.rpc,
  },
}));

import { usePOSStockProducts } from '../hooks/usePOSStockProducts';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  const result = {
    data: [
      {
        id: 'p1',
        is_active: true,
        is_display_item: true,
        is_sellable: true,
        sku: 'SKU-1',
        name: 'Croissant',
        unit: 'pcs',
        image_url: null,
        min_stock_threshold: 2,
        retail_price: 25_000,
        category_id: 'c1',
        display_stock: { quantity: 7 },
        categories: { id: 'c1', name: 'Pastry', slug: 'pastry' },
      },
    ],
    error: null,
  };
  api.rpc.mockResolvedValue(result);
});

describe('usePOSStockProducts', () => {
  it('maps display_stock from the embedded object and filters is_display_item', async () => {
    const { result } = renderHook(() => usePOSStockProducts(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rows = result.current.data ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.display_stock).toBe(7);
    expect(rows[0]?.name).toBe('Croissant');
    expect(rows[0]?.category_name).toBe('Pastry');

    expect(api.rpc).toHaveBeenCalledWith('get_operational_products_v2');
  });

  it.each([null, { quantity: null }, { quantity: 0 }])('preserves null and zero display counters for %j', async (displayStock) => {
    api.rpc.mockResolvedValue({
      data: [
        {
          id: 'p2',
          is_active: true,
          is_display_item: true,
          is_sellable: true,
          sku: 'SKU-2',
          name: 'Baguette',
          unit: 'pcs',
          image_url: null,
          min_stock_threshold: 0,
          retail_price: 10_000,
          category_id: 'c1',
          display_stock: displayStock,
          categories: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePOSStockProducts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data ?? [];
    expect(rows[0]?.display_stock).toBe(displayStock?.quantity ?? null);
    expect(rows[0]?.category_name).toBe('Uncategorized');
  });
});
