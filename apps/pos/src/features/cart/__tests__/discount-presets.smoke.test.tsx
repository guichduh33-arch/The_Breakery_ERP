// apps/pos/src/features/cart/__tests__/discount-presets.smoke.test.tsx
//
// S73 A5 (Task 6) — the cart-level DiscountModal now receives the
// org-configured pos_discount_presets (via usePOSPresets()) at both POS
// call-sites. This smoke confirms the wiring: opening the cart discount
// modal from the bottom bar renders the one-tap presets strip.

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
    // usePOSPresets() reads pos_discount_presets via this RPC; resolving with
    // null data exercises the hook's built-in fallback (never empty — see
    // apps/pos/src/features/settings/hooks/usePOSPresets.ts).
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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

const ITEM = {
  id: 'l1',
  product_id: 'p1',
  name: 'Americano',
  unit_price: 35000,
  quantity: 1,
  modifiers: [] as never[],
};

function renderBar() {
  return render(wrapper(<BottomActionBar />));
}

describe('BottomActionBar — discount modal presets (S73 A5)', () => {
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

  it('discount modal shows the org presets', async () => {
    renderBar(); // helper existant, cart non vide
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /apply discount/i }));
    expect(await screen.findByTestId('discount-presets')).toBeInTheDocument();
  });
});
