// apps/pos/src/__tests__/golden-path.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';

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

describe('ActiveOrderPanel smoke', () => {
  beforeEach(() => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' } });
  });

  it('shows EMPTY BAG when cart empty', () => {
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getByText(/empty bag/i)).toBeInTheDocument();
  });

  it('shows totals when items added', () => {
    useCartStore.setState({
      cart: {
        items: [
          { product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1 },
          { product_id: 'p2', name: 'Flat White', unit_price: 45000, quantity: 1 },
        ],
        order_type: 'dine_in',
      },
    });
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getAllByText(/total/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rp 80,000/).length).toBeGreaterThan(0);
  });
});
