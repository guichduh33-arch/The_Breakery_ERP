/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn().mockResolvedValue({ data: 'new-order-uuid', error: null }),
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
          not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        })),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
    })),
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
      <MemoryRouter initialEntries={['/tablet/order']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('tablet-send smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    mocks.rpc.mockResolvedValue({ data: 'new-order-uuid', error: null });
    useTabletCartStore.setState({ items: [], tableNumber: null, orderType: 'dine_in' });
    useAuthStore.setState({
      user: { id: 'waiter-001', full_name: 'Waiter Demo', role_code: 'waiter', employee_code: 'EMP002' },
      permissions: ['sales.create'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
    });
  });

  it('send-to-kitchen button is disabled when cart is empty', async () => {
    const { TabletCheckoutButton } = await import('@/features/tablet/components/TabletCheckoutButton');
    render(wrapper(<TabletCheckoutButton />));
    expect(screen.getByRole('button', { name: /send to kitchen/i })).toBeDisabled();
  });

  it('calls create_tablet_order_v3 RPC with correct payload and navigates to /tablet/orders on success', async () => {
    const { TabletCheckoutButton } = await import('@/features/tablet/components/TabletCheckoutButton');
    const { toast } = await import('sonner');
    useTabletCartStore.setState({
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
        { id: 'l2', product_id: 'p2', name: 'Croissant', unit_price: 25000, quantity: 2, modifiers: [] },
      ],
      tableNumber: 'T-03',
      orderType: 'dine_in',
    });

    render(wrapper(<TabletCheckoutButton />));
    const btn = screen.getByRole('button', { name: /send to kitchen/i });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('create_tablet_order_v3', expect.objectContaining({
        p_client_uuid: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) as unknown,
        p_waiter_id: 'waiter-001',
        p_table_number: 'T-03',
        p_order_type: 'dine_in',
      }));
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Order sent to kitchen');
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/tablet/orders', {
        state: { justSentOrderId: 'new-order-uuid' },
      });
    });

    expect(useTabletCartStore.getState().items).toHaveLength(0);
  });

  it('shows error toast when RPC fails', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission_denied' } });
    const { TabletCheckoutButton } = await import('@/features/tablet/components/TabletCheckoutButton');
    const { toast } = await import('sonner');
    useTabletCartStore.setState({
      items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
      tableNumber: null,
      orderType: 'dine_in',
    });

    render(wrapper(<TabletCheckoutButton />));
    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });
});
