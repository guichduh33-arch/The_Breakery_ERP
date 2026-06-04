// apps/pos/src/features/cart/__tests__/void-order.smoke.test.tsx
//
// Session 36 — "Void Order" in the bottom bar:
//   - before any kitchen send → voids immediately.
//   - after items were sent to kitchen (locked) → requires a manager PIN first
//     (the order is NOT wiped until the PIN modal is satisfied).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { BottomActionBar } from '../BottomActionBar';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { setSession: vi.fn(), signOut: vi.fn().mockResolvedValue({}), getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        })),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const ITEM = { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] as never[] };

describe('BottomActionBar — Void Order', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: { items: [ITEM], order_type: 'dine_in' },
      lockedItemIds: [],
      printedItemIds: [],
      appliedPromotions: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
    });
  });

  it('voids immediately when nothing has been sent to the kitchen', () => {
    render(wrapper(<BottomActionBar />));
    fireEvent.click(screen.getByRole('button', { name: /void order/i }));
    expect(useCartStore.getState().cart.items).toHaveLength(0);
  });

  it('requires a manager PIN once items were sent (does not wipe yet)', () => {
    useCartStore.setState({
      cart: { items: [ITEM], order_type: 'dine_in' },
      lockedItemIds: ['l1'],
      printedItemIds: ['l1'],
    });
    render(wrapper(<BottomActionBar />));
    fireEvent.click(screen.getByRole('button', { name: /void order/i }));
    // PIN modal appears…
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    // …and the order is still intact until the PIN is satisfied.
    expect(useCartStore.getState().cart.items).toHaveLength(1);
  });
});
