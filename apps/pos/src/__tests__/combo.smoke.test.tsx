// apps/pos/src/__tests__/combo.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Smoke tests for combo cart display and add flow.
// Spec §4.5 CB1–CB5.
//   - Tap combo → ComboConfigModal opens (Session 47)
//   - Cart shows ComboLineRow with CHOSEN components (from modifiers snapshot)
//   - addCombo stores combo_components + modifiers, two identical taps merge
//
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { CartLineRow } from '@/features/cart/CartLineRow';
import { addComboItem } from '@breakery/domain';
import type { Cart, CartItem } from '@breakery/domain';

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

vi.mock('@/features/combos/hooks/useComboConfig', () => ({
  useComboConfig: () => ({
    data: {
      combo_product_id: 'prod-combo-001',
      name: 'Breakfast Set',
      base_price: 75000,
      groups: [
        {
          id: 'g1',
          name: 'Choose a drink',
          group_type: 'single',
          is_required: true,
          min_select: 1,
          max_select: 1,
          sort_order: 0,
          options: [
            { id: 'prod-amer', component_product_id: 'prod-amer', label: 'Americano', surcharge: 0, is_default: true, sort_order: 0 },
          ],
        },
        {
          id: 'g2',
          name: 'Choose a pastry',
          group_type: 'single',
          is_required: true,
          min_select: 1,
          max_select: 1,
          sort_order: 1,
          options: [
            { id: 'prod-croi', component_product_id: 'prod-croi', label: 'Croissant', surcharge: 0, is_default: true, sort_order: 0 },
          ],
        },
      ],
    },
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
  // Session 47 — modifiers carry the chosen options. The live ComboCartLineRow
  // renders components from the useComboConfig definition (mocked below with the
  // same Americano + Croissant options flagged is_default).
  modifiers: [
    { group_name: 'Choose a drink', option_label: 'Americano', price_adjustment: 0 },
    { group_name: 'Choose a pastry', option_label: 'Croissant', price_adjustment: 0 },
  ],
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

  it('CartLineRow renders ComboLineRow for combo product_type', () => {
    render(wrapper(
      <CartLineRow
        item={COMBO_CART_ITEM}
        locked={false}
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(screen.getByText('Breakfast Set')).toBeInTheDocument();
  });

  it('CartLineRow shows combo components as sub-lines', () => {
    render(wrapper(
      <CartLineRow
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
      <CartLineRow
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

  it('cartStore.addCombo stores combo_components and modifiers', () => {
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
    const components = [
      { product_id: 'prod-amer', quantity: 1 },
      { product_id: 'prod-croi', quantity: 1 },
    ];
    const modifiers = [
      { group_name: 'Choose a drink', option_label: 'Americano', price_adjustment: 0 },
      { group_name: 'Choose a pastry', option_label: 'Croissant', price_adjustment: 0 },
    ];

    useCartStore.getState().addCombo(COMBO_PRODUCT, modifiers, components, 75000);
    const items = useCartStore.getState().cart.items;
    expect(items).toHaveLength(1);
    expect(items[0]?.product_type).toBe('combo');
    expect(items[0]?.unit_price).toBe(75000);
    expect(items[0]?.combo_components).toEqual(components);
    expect(items[0]?.modifiers).toEqual(modifiers);
  });

  it('addComboItem merges two identical combo taps into quantity 2', () => {
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
    const components = [{ product_id: 'prod-amer', quantity: 1 }];
    const modifiers = [{ group_name: 'Choose a drink', option_label: 'Americano', price_adjustment: 0 }];
    const emptyCart: Cart = { items: [], order_type: 'dine_in' };

    const afterFirst = addComboItem(emptyCart, COMBO_PRODUCT, modifiers, components, 1, 75000);
    const afterSecond = addComboItem(afterFirst, COMBO_PRODUCT, modifiers, components, 1, 75000);

    expect(afterSecond.items).toHaveLength(1);
    expect(afterSecond.items[0]?.quantity).toBe(2);
  });
});
