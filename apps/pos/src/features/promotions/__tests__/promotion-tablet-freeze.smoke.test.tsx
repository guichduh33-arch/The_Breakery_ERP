// apps/pos/src/features/promotions/__tests__/promotion-tablet-freeze.smoke.test.tsx
// Session 8 smoke test — P10: tablet checkout freeze semantics.
// Spec: create_tablet_order must include p_evaluation_ts (ISO timestamp) so the
// server re-evaluates promotions at the same instant, preventing a second live
// evaluation at pay time. This test asserts that create_tablet_order RPC is
// called with a valid p_evaluation_ts and that evaluate_promotions is NOT called
// a second time during the checkout flow.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';
import type { AppliedPromotion } from '@breakery/domain';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
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
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TABLET_PROMO: AppliedPromotion = {
  promotion_id: 'promo-tablet-001',
  name: 'Tablet Happy Hour',
  action_type: 'percentage_off',
  target: 'cart',
  target_product_id: null,
  discount_amount: 5000,
  items_to_add: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tablet/order']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('promotion-tablet-freeze smoke (P10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    mocks.rpc.mockResolvedValue({ data: 'order-tablet-uuid', error: null });

    useTabletCartStore.setState({
      items: [
        {
          id: 'l1',
          product_id: 'p1',
          name: 'Americano',
          unit_price: 35000,
          quantity: 2,
          modifiers: [],
        },
      ],
      tableNumber: 'T-01',
      orderType: 'dine_in',
      appliedPromotion: TABLET_PROMO,
      previewItems: [],
    });

    useAuthStore.setState({
      user: {
        id: 'waiter-tablet',
        full_name: 'Tablet Waiter',
        role_code: 'waiter',
        employee_code: 'EMP003',
      },
      permissions: ['sales.create'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
    });
  });

  it('create_tablet_order is called with a valid ISO p_evaluation_ts', async () => {
    const { TabletCheckoutButton } = await import(
      '@/features/tablet/components/TabletCheckoutButton'
    );
    render(wrapper(<TabletCheckoutButton />));
    const btn = screen.getByRole('button', { name: /send to kitchen/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('create_tablet_order', expect.anything());
    });

    // Verify the call argument contains a valid ISO p_evaluation_ts
    const callArgs = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    const ts = callArgs[1]?.p_evaluation_ts as string;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('evaluate_promotions is NOT called during create_tablet_order (freeze: no double eval)', async () => {
    // The useCreateTabletOrder hook calls supabase.rpc('create_tablet_order', ...) once.
    // It must NOT call supabase.rpc('evaluate_promotions', ...) during checkout.
    const { TabletCheckoutButton } = await import(
      '@/features/tablet/components/TabletCheckoutButton'
    );
    render(wrapper(<TabletCheckoutButton />));
    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalled();
    });

    const evaluatePromoCall = (mocks.rpc.mock.calls as [string, ...unknown[]][]).find(
      ([fn]) => fn === 'evaluate_promotions',
    );
    expect(evaluatePromoCall).toBeUndefined();
  });

  it('TabletPromotionsSummary shows applied promo from tabletCartStore', async () => {
    const { TabletPromotionsSummary } = await import(
      '@/features/tablet/components/TabletPromotionsSummary'
    );
    render(wrapper(<TabletPromotionsSummary />));
    expect(screen.getByText(/Tablet Happy Hour/)).toBeInTheDocument();
  });
});
