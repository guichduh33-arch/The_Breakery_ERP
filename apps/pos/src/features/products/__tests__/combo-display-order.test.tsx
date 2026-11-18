// apps/pos/src/features/products/__tests__/combo-display-order.test.tsx
//
// S3-13 — l'ordre d'affichage des combos saisi au back-office
// (products.combo_display_order) prime sur le nom, dans l'onglet Combos comme
// partout où un combo apparaît dans la grille.

/// <reference types="@testing-library/jest-dom" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/features/products/hooks/useCategories', () => ({
  useCategories: () => ({ data: [{ id: 'cat-1', name: 'Bakery', slug: 'bakery', sort_order: 0, is_active: true }] }),
}));
vi.mock('@/features/products/hooks/usePrefetchProductModifiers', () => ({
  usePrefetchProductModifiers: () => undefined,
}));

import { applyComboDisplayOrder, useProducts } from '../hooks/useProducts';
import { ProductGrid } from '../ProductGrid';

const base = { sku: 'X', category_id: 'cat-1', retail_price: 10_000, wholesale_price: null,
  image_url: null, current_stock: null, is_active: true, is_favorite: false, visible_on_pos: true,
  parent_product_id: null, categories: null, display_stock: null, is_sellable: true, has_variants: false };

// Le nom place A avant B ; l'ordre back-office place B (1) avant A (2).
const COMBO_A = { ...base, id: 'combo-a', name: 'A Combo', product_type: 'combo', combo_display_order: 2 };
const COMBO_B = { ...base, id: 'combo-b', name: 'B Combo', product_type: 'combo', combo_display_order: 1 };
const BREAD = { ...base, id: 'bread', name: 'Baguette', product_type: 'finished', combo_display_order: 0 };

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: client() }, children);
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: [COMBO_A, BREAD, COMBO_B], error: null });
});

describe('S3-13 combo display order', () => {
  it('useProducts orders combos by combo_display_order before name', async () => {
    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ids = (result.current.data ?? []).map((p) => p.id);
    expect(ids.indexOf('combo-b')).toBeLessThan(ids.indexOf('combo-a'));
  });

  it('keeps non-combo products in their name slot', () => {
    const out = applyComboDisplayOrder([COMBO_A, COMBO_B, { ...BREAD, name: 'Z Bread' }]);
    expect(out.map((p) => p.id)).toEqual(['combo-b', 'combo-a', 'bread']);
  });

  it('falls back to name when display orders are equal', () => {
    const out = applyComboDisplayOrder([{ ...COMBO_A, combo_display_order: 0 }, { ...COMBO_B, combo_display_order: 0 }]);
    expect(out.map((p) => p.id)).toEqual(['combo-a', 'combo-b']);
  });

  it('the Combos tab renders combo B (order 1) before combo A (order 2)', async () => {
    render(createElement(QueryClientProvider, { client: client() },
      createElement(ProductGrid, { selectedSlug: 'combos', onSelect: vi.fn() })));
    await waitFor(() => expect(screen.getByText('A Combo')).toBeInTheDocument());
    const a = screen.getByText('A Combo');
    const b = screen.getByText('B Combo');
    // B précède A dans l'ordre du document.
    expect(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Baguette')).toBeNull();
  });
});
