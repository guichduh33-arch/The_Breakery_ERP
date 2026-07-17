// apps/pos/src/features/products/__tests__/product-tap-combo.smoke.test.tsx
//
// Session 47 — smoke tests for ProductTapHandler combo tap → ComboConfigModal
// → addCombo flow (D3).
//
//   T1. Tapping a combo product opens ComboConfigModal (group label renders).
//   T2. Confirming the modal calls addCombo with components + modifiers + unitPrice.
//
// Implementation notes:
//   - All mock data objects that end up in useEffect dependency arrays are
//     wrapped in vi.hoisted() refs — prevents infinite re-render loops.
//     (project memory: project_vitest_hoisted_mock_data / DEV-S39-B1-01)
//   - ProductTapHandler is imported at the module top level so mocks are in
//     effect when the module initialises.
//   - explicit afterEach(cleanup) guarantees DOM isolation between T1 and T2.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Product, ComboDefinition } from '@breakery/domain';

// ---------------------------------------------------------------------------
// All mock data in vi.hoisted so vi.mock factories can reference them safely.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const COMBO_PRODUCT = {
    id: 'prod-combo-tap-001',
    sku: 'COMBO-TAP-001',
    name: 'Tap Breakfast Set',
    category_id: 'cat-bev',
    retail_price: 75000,
    wholesale_price: null,
    product_type: 'combo' as const,
    image_url: null,
    current_stock: 99,
    is_active: true,
    is_favorite: false,
    parent_product_id: null,
    has_variants: false,
  };

  const COMBO_DEF = {
    combo_product_id: 'prod-combo-tap-001',
    name: 'Tap Breakfast Set',
    base_price: 75000,
    groups: [
      {
        id: 'g-tap-1',
        name: 'Choose a drink',
        group_type: 'single' as const,
        is_required: true,
        min_select: 1,
        max_select: 1,
        sort_order: 0,
        options: [
          {
            id: 'opt-amer-tap',
            component_product_id: 'prod-amer-tap',
            label: 'Americano',
            surcharge: 0,
            is_default: true,
            sort_order: 0,
          },
        ],
      },
    ],
  };

  // comboQuery uses a mutable object so beforeEach can swap .data without
  // creating a new reference (ComboConfigModal's useEffect dep on `def`).
  const comboQuery = {
    isLoading: false,
    isSuccess: true,
    data: COMBO_DEF as ComboDefinition | undefined,
  };

  const addComboSpy = vi.fn();

  return { COMBO_PRODUCT, COMBO_DEF, comboQuery, addComboSpy };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/features/combos/hooks/useComboConfig', () => ({
  useComboConfig: (_id: string) => mocks.comboQuery,
}));

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: [mocks.COMBO_PRODUCT], isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/products/hooks/useCategories', () => ({
  useCategories: () => ({ data: [], isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/products/hooks/useActiveLotsByProduct', () => ({
  useActiveLotsByProduct: () => ({ data: new Map(), isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/products/hooks/useProductAllergens', () => ({
  useProductAllergensMap: () => ({ data: new Map(), isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/products/hooks/useProductVariants', () => ({
  useProductVariants: () => ({ data: [] }),
}));

vi.mock('@/features/products/hooks/useProductModifiers', () => ({
  useProductModifiers: () => ({ data: [], isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/customerCategories/hooks/useCustomerProductPrice', () => ({
  useCustomerProductPrice: () => () => Promise.resolve(undefined),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/stores/cartStore', () => ({
  useCartStore: <T,>(
    selector: (s: {
      add: (...args: unknown[]) => void;
      addCombo: typeof mocks.addComboSpy;
      attachedCustomer: null;
    }) => T,
  ) => selector({ add: vi.fn(), addCombo: mocks.addComboSpy, attachedCustomer: null }),
}));

// ---------------------------------------------------------------------------
// Module import (after mocks are registered)
// ---------------------------------------------------------------------------
import { ProductTapHandler } from '../ProductTapHandler';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductTapHandler — combo flow (Session 47 D3)', () => {
  beforeEach(() => {
    mocks.addComboSpy.mockClear();
    // Restore stable data ref (mutation in place to preserve reference identity).
    mocks.comboQuery.data = mocks.COMBO_DEF;
    mocks.comboQuery.isLoading = false;
    mocks.comboQuery.isSuccess = true;
  });

  afterEach(() => {
    cleanup();
  });

  it(
    'T1: tapping a combo product opens ComboConfigModal with group label',
    async () => {
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <ProductTapHandler selectedSlug={null} />
        </Wrapper>,
      );

      // Tap the combo product card.
      fireEvent.click(screen.getByTestId('product-card-prod-combo-tap-001'));

      // ComboConfigModal opens; 'Choose a drink' is the group label and only
      // appears inside the modal (not on the product grid card).
      await screen.findByText('Choose a drink', {}, { timeout: 18000 });
      // The Confirm button is also unique to the modal.
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    },
    20000,
  );

  it(
    'T2: confirming modal calls addCombo with components + modifiers + base_price',
    async () => {
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <ProductTapHandler selectedSlug={null} />
        </Wrapper>,
      );

      // Tap combo card to open modal.
      fireEvent.click(screen.getByTestId('product-card-prod-combo-tap-001'));
      await screen.findByText('Choose a drink', {}, { timeout: 18000 });

      // The default option (Americano) is pre-selected; click Confirm.
      const confirmBtn = screen.getByRole('button', { name: /confirm/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => expect(mocks.addComboSpy).toHaveBeenCalledTimes(1));

      const [calledProduct, calledModifiers, calledComponents, calledUnitPrice] =
        mocks.addComboSpy.mock.calls[0] as [
          Product,
          { group_name: string; option_label: string; price_adjustment: number }[],
          { product_id: string; quantity: number }[],
          number,
        ];

      expect(calledProduct.id).toBe('prod-combo-tap-001');
      expect(calledUnitPrice).toBe(75000);
      expect(calledComponents).toEqual([{ product_id: 'prod-amer-tap', quantity: 1 }]);
      expect(calledModifiers).toEqual([
        { group_name: 'Choose a drink', option_label: 'Americano', price_adjustment: 0 },
      ]);
    },
    20000,
  );
});
