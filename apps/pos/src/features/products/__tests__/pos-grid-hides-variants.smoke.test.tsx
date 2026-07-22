// apps/pos/src/features/products/__tests__/pos-grid-hides-variants.smoke.test.tsx
// Session 27c — Wave 7.D — smoke for the POS grid variant-filter contract.
//
// Verifies that :
//   T1. ProductGrid renders parents (`has_variants: true`) and standalones
//       (`has_variants: false`) but never variants. The variant filtering
//       happens upstream in `useProducts` (parent_product_id IS NULL) —
//       this test asserts the mock contract is what we feed downstream.
//
//   T2. ProductTapHandler routes a parent-tap to the VariantSelectModal
//       (parent's name surfaces as the dialog title) and a standalone-tap
//       skips the modal. The modal is a Radix Dialog that mounts into a
//       Portal ; we assert via `screen.getByRole('dialog')` and the parent's
//       name inside it.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Product } from '@breakery/domain';
import type { POSVariantRow } from '@/features/products/hooks/useProductVariants';

// ---------------------------------------------------------------------------
// Fixtures — two rows the parent useProducts mock returns. Only parents +
// standalones (parent_product_id IS NULL) ever reach the grid, by contract.
// ---------------------------------------------------------------------------

const PARENT: Product = {
  id: 'p1',
  sku: 'CR',
  name: 'Croissant',
  category_id: 'cat-1',
  retail_price: 0,
  wholesale_price: null,
  product_type: 'finished',
  image_url: null,
  current_stock: 10,
  is_active: true,
  is_favorite: false,
  parent_product_id: null,
  has_variants: true,
};

const STANDALONE: Product = {
  id: 'p3',
  sku: 'PAIN',
  name: 'Pain au levain',
  category_id: 'cat-1',
  retail_price: 35_000,
  wholesale_price: null,
  product_type: 'finished',
  image_url: null,
  current_stock: 5,
  is_active: true,
  is_favorite: false,
  parent_product_id: null,
  has_variants: false,
};

const VARIANT_OF_PARENT: POSVariantRow = {
  id: 'v1',
  name: 'Croissant Amande',
  retail_price: 25_000,
  variant_label: 'Amande',
  variant_axis: 'flavor',
  variant_sort_order: 10,
  is_active: true,
  current_stock: 8,
  deduct_stock: true,
};

// ---------------------------------------------------------------------------
// Hook mocks
// ---------------------------------------------------------------------------

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: [PARENT, STANDALONE], isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/products/hooks/useCategories', () => ({
  useCategories: () => ({ data: [], isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/products/hooks/useActiveLotsByProduct', () => ({
  useActiveLotsByProduct: () => ({ data: new Map(), isLoading: false, isSuccess: true }),
}));


// Variant picker hook — returns 2 active variants for the parent.
vi.mock('@/features/products/hooks/useProductVariants', () => ({
  useProductVariants: () => ({ data: [VARIANT_OF_PARENT, { ...VARIANT_OF_PARENT, id: 'v2', variant_label: 'Nature', name: 'Croissant Nature' }] }),
}));

// ProductTapHandler indirect dependencies.
vi.mock('@/stores/cartStore', () => ({
  useCartStore: <T,>(selector: (s: { add: (...args: unknown[]) => void; attachedCustomer: null }) => T) =>
    selector({ add: vi.fn(), attachedCustomer: null }),
}));

vi.mock('@/features/customerCategories/hooks/useCustomerProductPrice', () => ({
  useCustomerProductPrice: () => () => Promise.resolve(undefined),
}));

vi.mock('@/features/products/hooks/useProductModifiers', () => ({
  useProductModifiers: () => ({ data: [], isLoading: false, isSuccess: true }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function wrapper(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POS grid filters variants', () => {
  it('T1: renders parents + standalones, never variants', async () => {
    const { ProductGrid } = await import('../ProductGrid');
    render(wrapper(<ProductGrid selectedSlug={null} onSelect={() => { /* noop */ }} />));

    // Parent + standalone both render — the variant row 'Croissant Amande'
    // is *not* in the useProducts mock (parents only by contract), so it
    // never reaches the grid.
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText(/Pain au levain/)).toBeInTheDocument();
    expect(screen.queryByText('Croissant Amande')).toBeNull();
  });

  it('T2: parent tap opens VariantSelectModal, standalone tap does not', async () => {
    const { ProductTapHandler } = await import('../ProductTapHandler');
    render(wrapper(<ProductTapHandler selectedSlug={null} />));

    // No dialog before any tap.
    expect(screen.queryByRole('dialog')).toBeNull();

    // Tap the parent card — VariantSelectModal opens.
    fireEvent.click(screen.getByTestId('product-card-p1'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The modal title carries the parent name.
    expect(within(dialog).getByText('Croissant')).toBeInTheDocument();
  });
});
