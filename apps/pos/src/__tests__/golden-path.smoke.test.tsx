// apps/pos/src/__tests__/golden-path.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';
import { CartItemRow } from '@/features/cart/CartItemRow';

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
    },
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
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [] });
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
