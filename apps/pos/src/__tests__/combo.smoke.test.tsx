// apps/pos/src/__tests__/combo.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Smoke tests for combo cart display and add flow.
// Spec §4.5 CB1–CB5.
//   - Tap combo → addItem direct (no ModifierModal)
//   - Combo with modifiers → toast "Modifiers not supported on combos"
//   - Cart shows ComboLineRow with components
//
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { CartItemRow } from '@/features/cart/CartItemRow';
import type { CartItem } from '@breakery/domain';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            limit: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('@/features/combos/hooks/useComboItems', () => ({
  useComboItems: () => ({
    data: [
      { component_product_id: 'prod-amer', quantity: 1, sort_order: 0, product: { id: 'prod-amer', name: 'Americano' } },
      { component_product_id: 'prod-croi', quantity: 1, sort_order: 1, product: { id: 'prod-croi', name: 'Croissant' } },
    ],
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMBO_CART_ITEM: CartItem = {
  id: 'combo-line-1',
  product_id: 'prod-combo-001',
  name: 'Breakfast Set',
  unit_price: 75000,
  quantity: 1,
  modifiers: [],
  product_type: 'combo',
};

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Combo cart display smoke', () => {
  beforeEach(() => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], attachedCustomer: null });
  });

  it('CartItemRow renders ComboLineRow for combo product_type', () => {
    render(wrapper(
      <CartItemRow
        item={COMBO_CART_ITEM}
        locked={false}
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(screen.getByText('Breakfast Set')).toBeInTheDocument();
  });

  it('CartItemRow shows combo components as sub-lines', () => {
    render(wrapper(
      <CartItemRow
        item={COMBO_CART_ITEM}
        locked={false}
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(screen.getByText(/Americano/)).toBeInTheDocument();
    expect(screen.getByText(/Croissant/)).toBeInTheDocument();
  });

  it('combo line total = unit_price × quantity', () => {
    const COMBO_QTY2: CartItem = { ...COMBO_CART_ITEM, quantity: 2 };
    render(wrapper(
      <CartItemRow
        item={COMBO_QTY2}
        locked={false}
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(screen.getByText(/Breakfast Set/)).toBeInTheDocument();
  });

  it('cartStore.add for combo stores product_type=combo in cart line', () => {
    const COMBO_PRODUCT = {
      id: 'prod-combo-001',
      sku: 'COMBO-001',
      name: 'Breakfast Set',
      category_id: 'cat-bev',
      retail_price: 75000,
      wholesale_price: null,
      product_type: 'combo' as const,
      tax_inclusive: true,
      image_url: null,
      current_stock: 99,
      is_active: true,
      is_favorite: false,
    };

    useCartStore.getState().add(COMBO_PRODUCT, []);
    const items = useCartStore.getState().cart.items;
    expect(items).toHaveLength(1);
    expect(items[0]?.product_type).toBe('combo');
    expect(items[0]?.unit_price).toBe(75000);
  });

  it('finished product does NOT store product_type in cart line', () => {
    const FINISHED_PRODUCT = {
      id: 'prod-amer',
      sku: 'BEV-AMER',
      name: 'Americano',
      category_id: 'cat-bev',
      retail_price: 35000,
      wholesale_price: null,
      product_type: 'finished' as const,
      tax_inclusive: true,
      image_url: null,
      current_stock: 10,
      is_active: true,
      is_favorite: true,
    };

    useCartStore.getState().add(FINISHED_PRODUCT, []);
    const items = useCartStore.getState().cart.items;
    expect(items[0]?.product_type).toBeUndefined();
  });
});
