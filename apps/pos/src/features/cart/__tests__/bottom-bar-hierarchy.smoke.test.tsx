// apps/pos/src/features/cart/__tests__/bottom-bar-hierarchy.smoke.test.tsx
//
// LOT 7 (POS P0 hardening, audit 2026-06-25) — visual hierarchy by touch size:
// Checkout (h-14) must dominate over Void/Send (h-12), which dominate the
// left-hand ghost management buttons (h-11). Bigger = more important = faster
// to hit during the rush.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('BottomActionBar — touch hierarchy (LOT 7)', () => {
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

  it('Checkout is the tallest CTA (h-14), dominating Send to Kitchen (h-12)', () => {
    render(wrapper(<BottomActionBar />));
    const checkout = screen.getByTestId('checkout-cta');
    const send = screen.getByRole('button', { name: /send to kitchen/i });

    expect(checkout.className).toContain('h-14');
    expect(send.className).toContain('h-12');
    // Checkout must not be smaller than the secondary actions.
    expect(checkout.className).not.toContain('h-11');
    expect(send.className).not.toContain('h-11');
  });

  it('left-hand management buttons stay at the ghost size (h-11)', () => {
    render(wrapper(<BottomActionBar />));
    const customer = screen.getByRole('button', { name: /customer/i });
    expect(customer.className).toContain('h-11');
  });
});
