// apps/pos/src/features/heldOrders/__tests__/reopen-held-order.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { useReopenHeldOrder } from '../hooks/useReopenHeldOrder';
import { useCartStore } from '@/stores/cartStore';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [], order_type: 'take_out' },
    lockedItemIds: [],
    printedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set(),
    isOffline: false,
  } as never);
});

describe('useReopenHeldOrder', () => {
  it('rehydrates the fired order with locked lines into the cart', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        order_id: 'order-5',
        order_number: '#0005',
        order_type: 'dine_in',
        customerId: null,
        tableNumber: '7',
        notes: null,
        items: [
          {
            id: 'oi-1',
            product_id: 'p1',
            name: 'Latte',
            unit_price: 30000,
            quantity: 1,
            modifiers: [],
            is_locked: true,
            kitchen_status: 'pending',
          },
        ],
      },
      error: null,
    });

    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    const orderId = await result.current.mutateAsync('order-5');

    expect(orderId).toBe('order-5');
    await waitFor(() => {
      const s = useCartStore.getState();
      expect(s.pickedUpOrderId).toBe('order-5');
      expect(s.cart.items.map((i) => i.id)).toEqual(['oi-1']);
      expect(s.lockedItemIds).toEqual(['oi-1']);
      expect(s.printedItemIds).toEqual(['oi-1']);
    });
  });

  it('restores customer badge via get_customer_v2 when customerId present', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'reopen_held_order_v1') {
        return Promise.resolve({
          data: {
            order_id: 'order-6',
            order_type: 'dine_in',
            customerId: 'c1',
            tableNumber: null,
            notes: null,
            items: [],
          },
          error: null,
        });
      }
      if (name === 'get_customer_v2') {
        return Promise.resolve({
          data: [{ id: 'c1', name: 'Pelanggan VIP', customer_type: 'retail', loyalty_points: 200, category: null }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    });

    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    await result.current.mutateAsync('order-6');

    await waitFor(() => {
      const s = useCartStore.getState();
      expect(s.cart.customerId).toBe('c1');
      expect(s.attachedCustomer?.name).toBe('Pelanggan VIP');
    });
    expect(rpc).toHaveBeenCalledWith('get_customer_v2', { p_id: 'c1' });
  });

  it('keeps customerId even if customer lookup fails (best-effort badge)', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'reopen_held_order_v1') {
        return Promise.resolve({
          data: {
            order_id: 'order-7',
            order_type: 'take_out',
            customerId: 'c2',
            tableNumber: null,
            notes: null,
            items: [],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: 'lookup fail' } });
    });

    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    const orderId = await result.current.mutateAsync('order-7');

    expect(orderId).toBe('order-7');
    const s = useCartStore.getState();
    expect(s.cart.customerId).toBe('c2');
    expect(s.attachedCustomer).toBeNull();
  });
});
