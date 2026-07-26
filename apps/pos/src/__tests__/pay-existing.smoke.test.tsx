/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { usePaymentStore } from '@/stores/paymentStore';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
    rpc: mocks.rpc,
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('pay-existing smoke', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // ADR-013 D9 — le nonce discount est piloté par le PIN porté ; on repart PIN vide.
    const { clearManagerPin } = await import('@/features/discounts/managerPinHolder');
    clearManagerPin();
    mocks.rpc.mockResolvedValue({ data: { order_number: '#T001' }, error: null });
    useCartStore.setState({
      cart: {
        items: [
          { id: 'item-1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
        ],
        order_type: 'dine_in',
        tableNumber: 'T-03',
      },
      lockedItemIds: ['item-1'],
      attachedCustomer: null,
      pickedUpOrderId: 'order-tablet-1',
    });
    useAuthStore.setState({
      user: { id: 'cashier-001', full_name: 'Cashier Demo', role_code: 'CASHIER', employee_code: 'EMP001' },
      permissions: ['payments.process'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
    });
    useShiftStore.setState({
      current: { id: 'session-123', opened_at: new Date().toISOString(), opening_cash: 0 },
    });
    usePaymentStore.setState((s) => ({ ...s, idempotencyKey: 'idem-key-1' }));
  });

  it('calls pay_existing_order (NOT complete_order_with_payment) when pickedUpOrderId is set', async () => {
    const { useCheckout } = await import('@/features/payment/hooks/useCheckout');
    const { result } = renderHook(() => useCheckout(), {
      wrapper: ({ children }) => wrapper(children),
    });

    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 },
      });
    });

    expect(mocks.rpc).toHaveBeenCalledWith('pay_existing_order_v15', expect.objectContaining({
      p_order_id: 'order-tablet-1',
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ADR-013 D9 — remise sur commande reprise : le nonce est minté via
  // verify-manager-pin (piloté par le PIN porté) puis transporté au RPC.
  it('mints the discount nonce via verify-manager-pin and forwards p_discount_auth_id', async () => {
    const { setManagerPin } = await import('@/features/discounts/managerPinHolder');
    setManagerPin('123456');
    useCartStore.setState((s) => ({
      cart: { ...s.cart, cartDiscount: { amount: 3000, type: 'fixed_amount', value: 3000, reason: 'test', authorized_by: 'mgr-1' } },
    }));
    // 1ᵉ fetch = mint verify-manager-pin → renvoie le nonce.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ verified_user_id: 'mgr-1', authorization_id: 'nonce-1' }),
    });

    const { useCheckout } = await import('@/features/payment/hooks/useCheckout');
    const { result } = renderHook(() => useCheckout(), {
      wrapper: ({ children }) => wrapper(children),
    });

    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 32000, cash_received: 32000, change_given: 0 },
      });
    });

    const [mintUrl, mintInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(mintUrl).toContain('verify-manager-pin');
    const mintHeaders = mintInit.headers as Record<string, string>;
    expect(mintHeaders['x-manager-pin']).toBe('123456');
    expect(mintInit.body as string).toContain('discount');
    expect(mocks.rpc).toHaveBeenCalledWith('pay_existing_order_v15', expect.objectContaining({
      p_discount_amount: 3000,
      p_discount_auth_id: 'nonce-1',
    }));
  });

  it('does NOT call pay_existing_order when pickedUpOrderId is null (standard POS flow)', async () => {
    useCartStore.setState({ pickedUpOrderId: null });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        order_id: 'ord-1',
        order_number: '#001',
        total: 35000,
        tax_amount: 3182,
        change_given: 0,
      }),
    });

    const { useCheckout } = await import('@/features/payment/hooks/useCheckout');
    const { result } = renderHook(() => useCheckout(), {
      wrapper: ({ children }) => wrapper(children),
    });

    await act(async () => {
      await result.current.mutateAsync({
        cart: useCartStore.getState().cart,
        payment: { method: 'cash', amount: 35000, cash_received: 35000, change_given: 0 },
      });
    });

    expect(mocks.rpc).not.toHaveBeenCalledWith('pay_existing_order_v15', expect.anything());
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('process-payment'),
      expect.anything(),
    );
  });

  it('resetCartAfterCheckout clears pickedUpOrderId', () => {
    expect(useCartStore.getState().pickedUpOrderId).toBe('order-tablet-1');
    resetCartAfterCheckout();
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();
  });
});
