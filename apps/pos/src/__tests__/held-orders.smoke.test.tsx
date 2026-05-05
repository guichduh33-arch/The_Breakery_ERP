// apps/pos/src/__tests__/held-orders.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { useHeldOrdersStore, HeldOrdersLimitError, HELD_ORDERS_LIMIT } from '@/stores/heldOrdersStore';
import { useHoldOrder } from '@/features/heldOrders/hooks/useHoldOrder';
import { useRestoreHeldOrder } from '@/features/heldOrders/hooks/useRestoreHeldOrder';
import { toast } from 'sonner';

const ITEM = { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 2, modifiers: [] };

describe('held-orders smoke — hold flow', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: { items: [ITEM], order_type: 'dine_in', tableNumber: 'T-03' },
      lockedItemIds: [],
      attachedCustomer: null,
    });
    useHeldOrdersStore.setState({ entries: [] });
  });

  it('holds the cart: cart clears, held count becomes 1', () => {
    const holdOrder = useHoldOrder();
    holdOrder('for Mr. Tan');

    expect(useCartStore.getState().cart.items).toHaveLength(0);
    expect(useHeldOrdersStore.getState().entries).toHaveLength(1);
  });

  it('held entry preserves items, tableNumber, notes', () => {
    const holdOrder = useHoldOrder();
    holdOrder('for Mr. Tan');

    const entry = useHeldOrdersStore.getState().entries[0]!;
    expect(entry.cart.items).toHaveLength(1);
    expect(entry.cart.items[0]?.name).toBe('Americano');
    expect(entry.cart.tableNumber).toBe('T-03');
    expect(entry.notes).toBe('for Mr. Tan');
  });

  it('toasts success after hold', () => {
    useHoldOrder()();
    expect(toast.success).toHaveBeenCalledWith('Held');
  });

  it('toasts error when cart is empty', () => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], attachedCustomer: null });
    useHoldOrder()();
    expect(toast.error).toHaveBeenCalledWith('Cart is empty');
  });

  it('throws HeldOrdersLimitError as toast when limit reached', () => {
    useHeldOrdersStore.setState({
      entries: Array.from({ length: HELD_ORDERS_LIMIT }, (_, i) => ({
        id: `held-${i}`,
        heldAt: new Date().toISOString(),
        cart: { items: [], customerId: null, loyaltyPointsToRedeem: 0, orderType: 'dine_in' as const, tableNumber: null },
      })),
    });
    useHoldOrder()();
    expect(toast.error).toHaveBeenCalledWith('Held orders limit reached');
  });
});

describe('held-orders smoke — restore flow', () => {
  const HELD_ID = 'held-uuid-1';

  beforeEach(() => {
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
    });
    useHeldOrdersStore.setState({
      entries: [
        {
          id: HELD_ID,
          heldAt: new Date().toISOString(),
          cart: {
            items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 2, modifiers: [] }],
            customerId: null,
            loyaltyPointsToRedeem: 0,
            orderType: 'dine_in',
            tableNumber: 'T-05',
          },
          notes: 'for Mr. Tan',
        },
      ],
    });
  });

  it('restores the held entry: cart gets items, held list is empty', () => {
    const restore = useRestoreHeldOrder();
    restore(HELD_ID);

    expect(useCartStore.getState().cart.items).toHaveLength(1);
    expect(useHeldOrdersStore.getState().entries).toHaveLength(0);
  });

  it('restores tableNumber from held snapshot', () => {
    const restore = useRestoreHeldOrder();
    restore(HELD_ID);

    expect(useCartStore.getState().cart.tableNumber).toBe('T-05');
  });

  it('no-op if id not found', () => {
    const restore = useRestoreHeldOrder();
    restore('nonexistent-id');

    expect(useCartStore.getState().cart.items).toHaveLength(0);
    expect(useHeldOrdersStore.getState().entries).toHaveLength(1);
  });

  it('locks cleared after restore', () => {
    useCartStore.setState((s) => ({ ...s, lockedItemIds: ['l1'] }));
    const restore = useRestoreHeldOrder();
    restore(HELD_ID);

    expect(useCartStore.getState().lockedItemIds).toHaveLength(0);
  });
});

describe('HeldOrdersLimitError', () => {
  it('is an instance of Error with correct name', () => {
    const err = new HeldOrdersLimitError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HeldOrdersLimitError');
    expect(err.message).toBe('Held orders limit reached');
  });
});

describe('resetCartAfterCheckout clears tableNumber', () => {
  it('tableNumber is cleared on checkout reset', () => {
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in', tableNumber: 'T-03' },
      lockedItemIds: [],
      attachedCustomer: null,
    });
    resetCartAfterCheckout();
    expect(useCartStore.getState().cart.tableNumber).toBeUndefined();
  });
});
