// apps/pos/src/__tests__/golden-path.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';
import { CartItemRow } from '@/features/cart/CartItemRow';
import type { Customer } from '@breakery/domain';

const BRONZE_CUSTOMER: Customer = {
  id: 'cust-bronze-uuid',
  name: 'Loyal Bronze Customer',
  phone: '+62822222222',
  email: null,
  customer_type: 'retail',
  loyalty_points: 120,
  lifetime_points: 120,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
};

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          not: vi.fn(() => ({
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
        not: vi.fn(() => ({
          not: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Session 1 baseline
// ---------------------------------------------------------------------------

describe('ActiveOrderPanel smoke', () => {
  beforeEach(() => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], attachedCustomer: null });
  });

  it('shows EMPTY BAG when cart empty', () => {
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getByText(/empty bag/i)).toBeInTheDocument();
  });

  it('shows totals when items added', () => {
    useCartStore.setState({
      cart: {
        items: [
          { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
          { id: 'l2', product_id: 'p2', name: 'Flat White', unit_price: 45000, quantity: 1, modifiers: [] },
        ],
        order_type: 'dine_in',
      },
      lockedItemIds: [],
    });
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getAllByText(/total/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rp 80,000/).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Session 2 — modifier UX + cart lock + send-to-kitchen golden path
// ---------------------------------------------------------------------------

describe('Session 2 golden path — modifiers + send to kitchen', () => {
  beforeEach(() => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [] });
  });

  it('cart shows modifier sub-line and correct price (35000 + 5000 = 40000)', () => {
    useCartStore.setState({
      cart: {
        items: [
          {
            id: 'l1',
            product_id: 'p1',
            name: 'Americano',
            unit_price: 35000,
            quantity: 1,
            modifiers: [
              { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
              { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
            ],
          },
        ],
        order_type: 'dine_in',
      },
      lockedItemIds: [],
    });
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText(/Hot · Oat milk/)).toBeInTheDocument();
    expect(screen.getAllByText(/Rp 40,000/).length).toBeGreaterThan(0);
  });

  it('locked item shows lock icon and greys quantity stepper', () => {
    useCartStore.setState({
      cart: {
        items: [
          {
            id: 'l1',
            product_id: 'p1',
            name: 'Americano',
            unit_price: 35000,
            quantity: 1,
            modifiers: [
              { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
              { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
            ],
          },
        ],
        order_type: 'dine_in',
      },
      lockedItemIds: ['l1'],
    });
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getAllByLabelText(/sent to kitchen/i).length).toBeGreaterThan(0);
  });

  it('unlocked items still appear editable after first send', () => {
    useCartStore.setState({
      cart: {
        items: [
          {
            id: 'l1',
            product_id: 'p1',
            name: 'Americano',
            unit_price: 35000,
            quantity: 1,
            modifiers: [],
          },
          {
            id: 'l2',
            product_id: 'p2',
            name: 'Croissant',
            unit_price: 25000,
            quantity: 1,
            modifiers: [],
          },
        ],
        order_type: 'dine_in',
      },
      lockedItemIds: ['l1'],
    });
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/sent to kitchen/i).length).toBeGreaterThan(0);
    // Croissant remove button is not locked
    expect(screen.getByRole('button', { name: /remove item/i })).toBeInTheDocument();
  });

  it('canEdit returns false for locked item', () => {
    useCartStore.setState({
      cart: {
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
        order_type: 'dine_in',
      },
      lockedItemIds: ['l1'],
    });
    expect(useCartStore.getState().canEdit('l1')).toBe(false);
    expect(useCartStore.getState().canEdit('l2')).toBe(true);
  });

  it('markLocked adds ids to lockedItemIds', () => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [] });
    useCartStore.getState().markLocked(['l1', 'l2']);
    expect(useCartStore.getState().lockedItemIds).toEqual(['l1', 'l2']);
  });

  it('markLocked is idempotent (no duplicates on second send)', () => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: ['l1'] });
    useCartStore.getState().markLocked(['l1', 'l2']);
    expect(useCartStore.getState().lockedItemIds).toEqual(['l1', 'l2']);
  });

  it('update is a no-op on locked item', () => {
    useCartStore.setState({
      cart: {
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
        order_type: 'dine_in',
      },
      lockedItemIds: ['l1'],
    });
    useCartStore.getState().update('l1', 5);
    expect(useCartStore.getState().cart.items[0]?.quantity).toBe(1);
  });

  it('remove is a no-op on locked item', () => {
    useCartStore.setState({
      cart: {
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
        order_type: 'dine_in',
      },
      lockedItemIds: ['l1'],
    });
    useCartStore.getState().remove('l1');
    expect(useCartStore.getState().cart.items).toHaveLength(1);
  });

  it('unlockedItems returns only non-locked items', () => {
    useCartStore.setState({
      cart: {
        items: [
          { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
          { id: 'l2', product_id: 'p2', name: 'Croissant', unit_price: 25000, quantity: 1, modifiers: [] },
        ],
        order_type: 'dine_in',
      },
      lockedItemIds: ['l1'],
    });
    const unlocked = useCartStore.getState().unlockedItems();
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]?.id).toBe('l2');
  });
});

// ---------------------------------------------------------------------------
// Session 2 — CartItemRow: toast on locked remove attempt
// ---------------------------------------------------------------------------

describe('CartItemRow — locked item toast (acceptance criterion #14)', () => {
  it('fires toast.error when remove is attempted on a locked item', async () => {
    const { toast } = await import('sonner');
    const onRemove = vi.fn();

    render(wrapper(
      <CartItemRow
        item={{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }}
        locked={true}
        onChangeQty={vi.fn()}
        onRemove={onRemove}
      />
    ));

    const removeBtn = screen.getByRole('button', { name: /sent to kitchen/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Item already sent. Cannot cancel.');
    });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('calls onRemove when item is not locked', () => {
    const onRemove = vi.fn();

    render(wrapper(
      <CartItemRow
        item={{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }}
        locked={false}
        onChangeQty={vi.fn()}
        onRemove={onRemove}
      />
    ));

    const removeBtn = screen.getByRole('button', { name: /remove item/i });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Session 3 — customer attach + earn (no redeem)
// ---------------------------------------------------------------------------

describe('Session 3 golden path — customer attach + loyalty earn', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: {
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
        order_type: 'dine_in',
      },
      lockedItemIds: [],
      attachedCustomer: null,
    });
  });

  it('attachCustomer stores full customer object in store', () => {
    useCartStore.getState().attachCustomer(BRONZE_CUSTOMER);
    expect(useCartStore.getState().attachedCustomer?.id).toBe('cust-bronze-uuid');
    expect(useCartStore.getState().cart.customerId).toBe('cust-bronze-uuid');
  });

  it('shows customer name + loyalty badge after attach', () => {
    useCartStore.getState().attachCustomer(BRONZE_CUSTOMER);
    render(wrapper(<ActiveOrderPanel onOpenCustomerSearch={vi.fn()} />));
    expect(screen.getByText('Loyal Bronze Customer')).toBeInTheDocument();
    expect(screen.getByText('Bronze')).toBeInTheDocument();
  });

  it('shows points to earn for 35000 cart (= 35 pts)', () => {
    useCartStore.getState().attachCustomer(BRONZE_CUSTOMER);
    render(wrapper(<ActiveOrderPanel onOpenCustomerSearch={vi.fn()} />));
    expect(screen.getByText(/points to earn/i)).toBeInTheDocument();
    expect(screen.getByText('35 pts')).toBeInTheDocument();
  });

  it('resetCartAfterCheckout clears customer and loyalty state', () => {
    useCartStore.getState().attachCustomer(BRONZE_CUSTOMER);
    useCartStore.getState().setRedeemPoints(100);
    resetCartAfterCheckout();
    expect(useCartStore.getState().attachedCustomer).toBeNull();
    expect(useCartStore.getState().cart.customerId).toBeUndefined();
    expect(useCartStore.getState().cart.loyaltyPointsToRedeem).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Session 4 — hold + restore golden path
// ---------------------------------------------------------------------------

// Session 35 (F-003) — hold + restore are now DB-backed. The hold wiring is
// covered by `features/heldOrders/__tests__/hold-order-db.smoke.test.tsx`; the
// restore side ultimately rehydrates the cart via `cartStore.restoreCart`,
// which we assert here at the store level (the mechanism the restore hook drives).
describe('Session 4 golden path — restore rehydrates the cart (DB-backed)', () => {
  const RESTORED = [
    { id: 'r1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] as never[] },
  ];

  beforeEach(() => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], attachedCustomer: null });
  });

  it('restoreCart replays a held snapshot into the cart incl. tableNumber + clears locks', () => {
    useCartStore.setState((s) => ({ ...s, lockedItemIds: ['stale'] }));
    useCartStore.getState().restoreCart({
      items: RESTORED,
      order_type: 'dine_in',
      tableNumber: 'T-02',
    });

    expect(useCartStore.getState().cart.items).toHaveLength(1);
    expect(useCartStore.getState().cart.tableNumber).toBe('T-02');
    expect(useCartStore.getState().lockedItemIds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Session 4 — table selection before checkout
// ---------------------------------------------------------------------------

describe('Session 4 golden path — table selection before checkout', () => {
  beforeEach(() => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], attachedCustomer: null });
  });

  it('setTableNumber stores table on cart', () => {
    useCartStore.getState().setTableNumber('T-03');
    expect(useCartStore.getState().cart.tableNumber).toBe('T-03');
  });

  it('resetCartAfterCheckout clears tableNumber (session 4 acceptance)', () => {
    useCartStore.setState((s) => ({ ...s, cart: { ...s.cart, tableNumber: 'T-03' } }));
    resetCartAfterCheckout();
    expect(useCartStore.getState().cart.tableNumber).toBeUndefined();
  });

  it('restoreCart bulk-replaces cart including tableNumber', () => {
    useCartStore.getState().restoreCart({
      items: [{ id: 'l99', product_id: 'p99', name: 'Cold Brew', unit_price: 50000, quantity: 2, modifiers: [] as never[] }],
      order_type: 'dine_in',
      tableNumber: 'VIP',
    });
    const state = useCartStore.getState();
    expect(state.cart.items).toHaveLength(1);
    expect(state.cart.tableNumber).toBe('VIP');
    expect(state.lockedItemIds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Session 5 — tablet pickup-and-pay golden path
// ---------------------------------------------------------------------------

describe('Session 5 golden path — tablet pickup-and-pay', () => {
  const TABLET_ITEMS = [
    { id: 'ti1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] as never[] },
    { id: 'ti2', product_id: 'p2', name: 'Croissant', unit_price: 25000, quantity: 1, modifiers: [] as never[] },
  ];

  beforeEach(() => {
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
    });
  });

  it('setPickedUpOrderId stores the order id', () => {
    useCartStore.getState().setPickedUpOrderId('tablet-order-99');
    expect(useCartStore.getState().pickedUpOrderId).toBe('tablet-order-99');
  });

  it('restoreCart after pickup does NOT touch pickedUpOrderId', () => {
    useCartStore.getState().setPickedUpOrderId('tablet-order-99');
    useCartStore.getState().restoreCart({
      items: TABLET_ITEMS,
      order_type: 'dine_in',
      tableNumber: 'T-03',
    });
    expect(useCartStore.getState().pickedUpOrderId).toBe('tablet-order-99');
    expect(useCartStore.getState().cart.items).toHaveLength(2);
  });

  it('markLocked after restoreCart locks all tablet items', () => {
    useCartStore.getState().restoreCart({ items: TABLET_ITEMS, order_type: 'dine_in' });
    useCartStore.getState().markLocked(TABLET_ITEMS.map((i) => i.id));
    expect(useCartStore.getState().lockedItemIds).toEqual(['ti1', 'ti2']);
    expect(useCartStore.getState().canEdit('ti1')).toBe(false);
  });

  it('resetCartAfterCheckout clears pickedUpOrderId (session 5 acceptance)', () => {
    useCartStore.setState({
      cart: { items: TABLET_ITEMS, order_type: 'dine_in', tableNumber: 'T-03' },
      lockedItemIds: ['ti1', 'ti2'],
      attachedCustomer: null,
      pickedUpOrderId: 'tablet-order-99',
    });
    resetCartAfterCheckout();
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();
    expect(useCartStore.getState().lockedItemIds).toHaveLength(0);
    expect(useCartStore.getState().cart.tableNumber).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Session 7 — default category customer attach golden path
// ---------------------------------------------------------------------------

describe('Session 7 golden path — default category (Retail) customer', () => {
  const RETAIL_CUSTOMER = {
    id: 'cust-retail',
    name: 'Regular Customer',
    phone: '+62800000000',
    email: null,
    customer_type: 'retail' as const,
    loyalty_points: 0,
    lifetime_points: 0,
    total_spent: 0,
    total_visits: 0,
    last_visit_at: null,
    category: {
      id: 'cat-retail',
      name: 'Retail',
      slug: 'retail',
      color: '#64748B',
      icon: null,
      price_modifier_type: 'retail' as const,
      discount_percentage: 0,
      loyalty_enabled: true,
      points_multiplier: 1.0,
      is_default: true,
    },
  };

  beforeEach(() => {
    useCartStore.setState({
      cart: {
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] as never[] }],
        order_type: 'dine_in',
      },
      lockedItemIds: [],
      attachedCustomer: null,
    });
  });

  it('attach Retail customer stores category in attachedCustomer', () => {
    useCartStore.getState().attachCustomer(RETAIL_CUSTOMER);
    const customer = useCartStore.getState().attachedCustomer;
    expect(customer?.name).toBe('Regular Customer');
    expect(useCartStore.getState().cart.customerId).toBe(RETAIL_CUSTOMER.id);
  });

  it('Retail customer cumul multiplier = 1.0 × 1.0 = 1.0 → no loyalty_multiplier in payload', async () => {
    const { buildOrderPayload } = await import('@breakery/domain');
    const cart = {
      order_type: 'dine_in' as const,
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] as never[] }],
      customerId: RETAIL_CUSTOMER.id,
    };
    const payload = buildOrderPayload('sess-7', cart, { method: 'cash', amount: 35000 }, undefined, undefined, 1.0);
    expect('loyalty_multiplier' in payload).toBe(false);
  });
});
