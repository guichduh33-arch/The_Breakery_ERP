// apps/pos/src/features/products/__tests__/product-tap-double-add.test.tsx
//
// Bug 2 (Session 36) — a single tap on a no-modifier product must call
// cartStore.add() exactly once, even under React StrictMode's dev double
// render. The original code ran `add()` in the render body, so StrictMode
// double-invoked it → the line quantity doubled (Croissant ×2 billed as ×4 =
// Rp 100,000 instead of Rp 50,000). The fix moves the auto-add into a guarded
// useEffect.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Product } from '@breakery/domain';

const CROISSANT: Product = {
  id: 'p-croissant',
  sku: 'CR',
  name: 'Croissant',
  category_id: 'cat-1',
  retail_price: 25000,
  wholesale_price: null,
  product_type: 'finished',
  image_url: null,
  current_stock: 10,
  is_active: true,
  is_favorite: false,
  parent_product_id: null,
  has_variants: false,
};

// Stable module-level spy so every `useCartStore(selector)` call returns the
// same `add`, letting us count invocations across renders.
const addSpy = vi.fn();

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: [CROISSANT], isLoading: false, isSuccess: true }),
}));
vi.mock('@/features/products/hooks/useCategories', () => ({
  useCategories: () => ({ data: [], isLoading: false, isSuccess: true }),
}));
vi.mock('@/features/products/hooks/useActiveLotsByProduct', () => ({
  useActiveLotsByProduct: () => ({ data: new Map(), isLoading: false, isSuccess: true }),
}));
vi.mock('@/features/products/hooks/useProductVariants', () => ({
  useProductVariants: () => ({ data: [] }),
}));
vi.mock('@/stores/cartStore', () => ({
  useCartStore: <T,>(selector: (s: { add: typeof addSpy; attachedCustomer: null }) => T) =>
    selector({ add: addSpy, attachedCustomer: null }),
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

function wrapper(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ProductTapHandler — no double-add under StrictMode (Bug 2)', () => {
  beforeEach(() => addSpy.mockClear());

  it('a single tap on a no-modifier product calls add() exactly once', async () => {
    const { ProductTapHandler } = await import('../ProductTapHandler');
    render(
      wrapper(
        <StrictMode>
          <ProductTapHandler selectedSlug={null} />
        </StrictMode>,
      ),
    );

    fireEvent.click(screen.getByTestId('product-card-p-croissant'));

    await waitFor(() => expect(addSpy).toHaveBeenCalled());
    // Let StrictMode's double render / any queued microtask settle so a stray
    // second dispatch would surface before we assert the exact count.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(CROISSANT, [], undefined);
  });
});
