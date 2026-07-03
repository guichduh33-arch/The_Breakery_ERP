// apps/pos/src/features/products/__tests__/product-grid-error.smoke.test.tsx
//
// S57 P2.3 (C-D1) — a failed products fetch must surface a distinct error panel
// (ErrorState, role="alert", "Réessayer") instead of the neutral "No products
// yet" empty state, which would mislead the cashier into thinking the catalog is
// empty. Tapping Retry re-runs the query.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const refetch = vi.fn();
let mockIsError = true;

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: [], isLoading: false, isError: mockIsError, refetch }),
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

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('ProductGrid — load error (C-D1)', () => {
  beforeEach(() => {
    refetch.mockClear();
    mockIsError = true;
  });

  it('renders the error panel (not the empty state) when the fetch fails', async () => {
    const { ProductGrid } = await import('../ProductGrid');
    render(wrap(<ProductGrid selectedSlug={null} onSelect={vi.fn()} />));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/impossible de charger les produits/i)).toBeInTheDocument();
    // The misleading empty-state copy must NOT appear on error.
    expect(screen.queryByText(/no products yet/i)).toBeNull();
  });

  it('calls refetch when Retry is tapped', async () => {
    const { ProductGrid } = await import('../ProductGrid');
    render(wrap(<ProductGrid selectedSlug={null} onSelect={vi.fn()} />));

    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
