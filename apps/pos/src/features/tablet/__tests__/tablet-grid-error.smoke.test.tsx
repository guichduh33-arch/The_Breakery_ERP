// apps/pos/src/features/tablet/__tests__/tablet-grid-error.smoke.test.tsx
//
// S57 P2.3 (C-D1) — the waiter tablet grid must show a distinct error panel on a
// failed products fetch, not the "No products yet" empty state.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const refetch = vi.fn();

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: [], isLoading: false, isError: true, refetch }),
}));
vi.mock('@/features/products/hooks/useCategories', () => ({
  useCategories: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/products/hooks/useActiveLotsByProduct', () => ({
  useActiveLotsByProduct: () => ({ data: new Map() }),
}));
vi.mock('@/features/products/hooks/useProductAllergens', () => ({
  useProductAllergensMap: () => ({ data: new Map() }),
}));
vi.mock('@/features/products/hooks/useProductModifiers', () => ({
  useProductModifiers: () => ({ data: [], isSuccess: false }),
}));
vi.mock('@/stores/tabletCartStore', () => ({
  useTabletCartStore: <T,>(selector: (s: { addItem: () => void }) => T) =>
    selector({ addItem: vi.fn() }),
}));

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('TabletProductGrid — load error (C-D1)', () => {
  beforeEach(() => refetch.mockClear());

  it('renders the error panel (not the empty state) when the fetch fails', async () => {
    const { TabletProductGrid } = await import('../components/TabletProductGrid');
    render(wrap(<TabletProductGrid selectedSlug={null} />));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/impossible de charger les produits/i)).toBeInTheDocument();
    expect(screen.queryByText(/no products yet/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
