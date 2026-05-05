/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const PICKUP_RESULT = {
  id: 'order-tablet-1',
  order_type: 'dine_in',
  table_number: 'T-03',
  order_number: '#T001',
};

const ORDER_ITEMS = [
  { id: 'item-1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
  { id: 'item-2', product_id: 'p2', name: 'Croissant', unit_price: 35000, quantity: 1, modifiers: [] },
];

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: mocks.from,
    rpc: mocks.rpc,
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('pickup-flow smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
    });
    useAuthStore.setState({
      user: { id: 'cashier-001', full_name: 'Cashier Demo', role_code: 'CASHIER', employee_code: 'EMP001' },
      permissions: ['payments.process'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
    });
    useShiftStore.setState({ current: { id: 'session-123', opened_at: new Date().toISOString(), opening_cash: 0 } });

    mocks.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: ORDER_ITEMS, error: null }),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    });

    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'pickup_tablet_order') {
        return Promise.resolve({ data: PICKUP_RESULT, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('renders tablet inbox button', async () => {
    const { TabletInboxButton } = await import('@/features/inbox/components/TabletInboxButton');
    render(wrapper(<TabletInboxButton />));
    await waitFor(() => {
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  it('pickup_tablet_order is called, cart is loaded with items locked, pickedUpOrderId is set', async () => {
    const { usePickupTabletOrder } = await import('@/features/inbox/hooks/usePickupTabletOrder');
    const onClose = vi.fn();

    function TestComponent() {
      const pickup = usePickupTabletOrder(onClose);
      return (
        <button onClick={() => pickup.mutate('order-tablet-1')}>Pickup</button>
      );
    }

    render(wrapper(<TestComponent />));
    fireEvent.click(screen.getByRole('button', { name: /pickup/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('pickup_tablet_order', {
        p_order_id: 'order-tablet-1',
        p_session_id: 'session-123',
      });
    });

    await waitFor(() => {
      const state = useCartStore.getState();
      expect(state.pickedUpOrderId).toBe('order-tablet-1');
      expect(state.cart.items).toHaveLength(2);
      expect(state.lockedItemIds).toContain('item-1');
      expect(state.lockedItemIds).toContain('item-2');
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('shows error toast on P0012 (already picked up)', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Order already picked up or not pending_payment (P0012)' },
    });
    const { toast } = await import('sonner');
    const { usePickupTabletOrder } = await import('@/features/inbox/hooks/usePickupTabletOrder');
    const onClose = vi.fn();

    function TestComponent() {
      const pickup = usePickupTabletOrder(onClose);
      return <button onClick={() => pickup.mutate('order-tablet-1')}>Pickup</button>;
    }

    render(wrapper(<TestComponent />));
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Already picked up by another cashier');
    });
  });
});
