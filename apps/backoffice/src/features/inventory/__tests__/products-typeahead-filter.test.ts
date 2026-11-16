import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useProductsForInventory } from '../hooks/useProductsForInventory.js';

const api = vi.hoisted(() => ({ rpc: vi.fn<(name: string) => Promise<{ data: unknown; error: null }>>() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: api.rpc } }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}
beforeEach(() => api.rpc.mockReset());

describe('Inventory catalogue filtering', () => {
  it('includes inactive tracked ingredients and excludes untracked products', async () => {
    api.rpc.mockResolvedValue({ data: [
      { id: 'tracked', sku: 'RAW-1', name: 'Flour', track_inventory: true, is_active: false, current_stock: null },
      { id: 'untracked', sku: 'RAW-2', name: 'Flour virtual', track_inventory: false, is_active: true, current_stock: null },
    ], error: null });
    const { result } = renderHook(() => useProductsForInventory('flour'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.rpc).toHaveBeenCalledWith('get_operational_products_v3');
    expect(result.current.data?.map((p) => p.id)).toEqual(['tracked']);
    expect(result.current.data?.[0]?.current_stock).toBeNull();
  });

  it('does not request the catalogue for a single character', () => {
    const { result } = renderHook(() => useProductsForInventory('f'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it.each(['T_PROD_FLOUR', 'Flour,"(white)', '100% flour', 'path\\flour'])(
    'matches a literal product name without interpreting special characters, %s', async (term) => {
      api.rpc.mockResolvedValue({ data: [
        { id: 'match', name: term, sku: 'RAW-1', track_inventory: true, current_stock: null },
        { id: 'other', name: 'Unrelated product', sku: 'RAW-2', track_inventory: true, current_stock: null },
      ], error: null });
      const { result } = renderHook(() => useProductsForInventory(term), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.map((p) => p.id)).toEqual(['match']);
      expect(api.rpc).toHaveBeenCalledWith('get_operational_products_v3');
    },
  );
});
