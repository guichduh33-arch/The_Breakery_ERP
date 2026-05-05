// apps/pos/src/__tests__/loyalty.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';
import type { Customer } from '@breakery/domain';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { setSession: vi.fn(), signOut: vi.fn().mockResolvedValue({}) } },
  supabaseUrl: 'http://localhost:54321',
}));

const GOLD_CUSTOMER: Customer = {
  id: 'cust-gold-uuid',
  name: 'Loyal Gold Customer',
  phone: '+62833333333',
  email: null,
  customer_type: 'retail',
  loyalty_points: 2500,
  lifetime_points: 2500,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
};

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Loyalty smoke — customer attach + earn display', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
    });
  });

  it('shows CustomerAttachButton when no customer attached', () => {
    render(wrapper(<ActiveOrderPanel onOpenCustomerSearch={vi.fn()} />));
    expect(screen.getByRole('button', { name: /attach customer/i })).toBeInTheDocument();
  });

  it('shows CustomerAttachedBadge after attaching a customer', () => {
    useCartStore.getState().attachCustomer(GOLD_CUSTOMER);
    render(wrapper(<ActiveOrderPanel onOpenCustomerSearch={vi.fn()} />));
    expect(screen.getByText('Loyal Gold Customer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /detach customer/i })).toBeInTheDocument();
  });

  it('shows loyalty badge tier Gold and points for attached customer', () => {
    useCartStore.getState().attachCustomer(GOLD_CUSTOMER);
    render(wrapper(<ActiveOrderPanel onOpenCustomerSearch={vi.fn()} />));
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText(/2,500 pts/)).toBeInTheDocument();
  });

  it('shows Points to earn line when items in cart and customer attached', () => {
    useCartStore.setState({
      cart: {
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
        order_type: 'dine_in',
      },
      lockedItemIds: [],
      attachedCustomer: GOLD_CUSTOMER,
    });
    render(wrapper(<ActiveOrderPanel onOpenCustomerSearch={vi.fn()} />));
    expect(screen.getByText(/points to earn/i)).toBeInTheDocument();
    expect(screen.getByText('35 pts')).toBeInTheDocument();
  });

  it('shows redemption discount line when points redeemed', () => {
    useCartStore.setState({
      cart: {
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
        order_type: 'dine_in',
        customerId: GOLD_CUSTOMER.id,
        loyaltyPointsToRedeem: 500,
      },
      lockedItemIds: [],
      attachedCustomer: GOLD_CUSTOMER,
    });
    render(wrapper(<ActiveOrderPanel onOpenCustomerSearch={vi.fn()} />));
    expect(screen.getByText(/loyalty discount/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Rp 30,000/).length).toBeGreaterThan(0);
  });

  it('detachCustomer removes customer and resets loyalty points', () => {
    useCartStore.getState().attachCustomer(GOLD_CUSTOMER);
    useCartStore.getState().setRedeemPoints(500);
    expect(useCartStore.getState().cart.loyaltyPointsToRedeem).toBe(500);
    useCartStore.getState().detachCustomer();
    expect(useCartStore.getState().attachedCustomer).toBeNull();
    expect(useCartStore.getState().cart.customerId).toBeUndefined();
    expect(useCartStore.getState().cart.loyaltyPointsToRedeem).toBeUndefined();
  });

  it('redemptionAmount computed getter returns correct value', () => {
    useCartStore.getState().attachCustomer(GOLD_CUSTOMER);
    useCartStore.getState().setRedeemPoints(500);
    expect(useCartStore.getState().redemptionAmount()).toBe(5000);
  });

  it('Redeem Points button appears when customer attached', () => {
    useCartStore.setState({
      cart: {
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }],
        order_type: 'dine_in',
      },
      lockedItemIds: [],
      attachedCustomer: GOLD_CUSTOMER,
    });
    render(wrapper(<ActiveOrderPanel onOpenCustomerSearch={vi.fn()} />));
    expect(screen.getByRole('button', { name: /redeem points/i })).toBeInTheDocument();
  });
});
