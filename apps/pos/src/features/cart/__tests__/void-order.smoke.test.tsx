// apps/pos/src/features/cart/__tests__/void-order.smoke.test.tsx
//
// "Void order" in the bottom bar (owner decision 2026-07-10 — under "More",
// always manager-PIN + a mandatory reason, whether or not anything was fired):
//   - the action lives in the More menu, not on the main bar;
//   - opening it shows a reason + PIN modal and does NOT wipe the order until
//     both are satisfied — for both the never-fired and the fired cases.

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

  function openVoid(): void {
    fireEvent.click(screen.getByRole('button', { name: /^more$/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /void order/i }));
  }

  it('lives under "More" and opens a reason+PIN modal without wiping the cart', () => {
    render(wrapper(<BottomActionBar />));
    // Void is NOT a top-level bar button — it lives in the More menu.
    expect(screen.queryByRole('button', { name: /void order/i })).toBeNull();

    openVoid();

    const dialog = screen.getByRole('alertdialog', { name: /void order/i });
    expect(dialog).toBeInTheDocument();
    // Mandatory reason + manager PIN are both present.
    expect(screen.getByLabelText(/void reason/i)).toBeInTheDocument();
    expect(screen.getByText(/manager pin/i)).toBeInTheDocument();
    // Nothing wiped until reason + PIN are satisfied.
    expect(useCartStore.getState().cart.items).toHaveLength(1);
  });

  it('still requires reason+PIN once items were sent to the kitchen', () => {
    useCartStore.setState({
      cart: { items: [ITEM], order_type: 'dine_in' },
      lockedItemIds: ['l1'],
      printedItemIds: ['l1'],
    });
    render(wrapper(<BottomActionBar />));
    openVoid();

    expect(screen.getByRole('alertdialog', { name: /void order/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/void reason/i)).toBeInTheDocument();
    expect(useCartStore.getState().cart.items).toHaveLength(1);
  });
});
