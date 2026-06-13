// apps/pos/src/__tests__/discount.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { BottomActionBar } from '@/features/cart/BottomActionBar';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
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
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// Default: verifyFn resolves ok with mgr-1
vi.mock('@/features/discounts/hooks/useVerifyManagerPin', () => ({
  useVerifyManagerPin: () => (_pin: string) => Promise.resolve({ ok: true as const, userId: 'mgr-1' }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** Click 6 numpad buttons by label, then click "Verify". */
function enterPin(labels: string[]) {
  for (const label of labels) {
    // Numpad buttons have aria-label equal to their digit label
    const buttons = screen.getAllByRole('button', { name: label });
    // Pick the last matching button to avoid hitting the discount numpad
    fireEvent.click(buttons[buttons.length - 1]!);
  }
  fireEvent.click(screen.getByRole('button', { name: /verify/i }));
}

const ITEMS = [
  { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] as never[] },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Discount smoke — cart discount with PIN guard', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: { items: ITEMS, order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
    });
    vi.clearAllMocks();
  });

  it('below threshold (5%): confirm STILL triggers PinVerificationModal (v11 gates ALL discounts), discount applied with authorized_by=mgr-1', async () => {
    render(wrapper(<BottomActionBar />));

    // Open discount modal via the bottom-bar More menu
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /apply discount/i }));

    await waitFor(() => {
      expect(screen.getByTestId('discount-value-display')).toBeInTheDocument();
    });

    // Type "5" — 5% discount (below the OLD 10% client threshold)
    fireEvent.click(screen.getByRole('button', { name: '5' }));

    // Fill reason
    fireEvent.change(screen.getByPlaceholderText(/why discount/i), {
      target: { value: 'Promotion staff' },
    });

    // Confirm — S43 Wave B2: server RPC v11 gates ALL discounts, so even
    // below-threshold confirms require manager authorization via PIN modal
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    // PIN modal appears
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    });

    // Enter 6-digit PIN and click Verify (mock resolves { ok: true, userId: 'mgr-1' })
    enterPin(['1', '2', '3', '4', '5', '6']);

    // Discount applied with manager authorization
    await waitFor(() => {
      const state = useCartStore.getState();
      expect(state.cart.cartDiscount).toBeDefined();
      expect(state.cart.cartDiscount?.type).toBe('percentage');
      expect(state.cart.cartDiscount?.value).toBe(5);
      expect(state.cart.cartDiscount?.reason).toBe('Promotion staff');
      expect(state.cart.cartDiscount?.authorized_by).toBe('mgr-1');
    });
  });

  it('above threshold (15%): confirm triggers PinVerificationModal, discount applied with authorized_by=mgr-1', async () => {
    render(wrapper(<BottomActionBar />));

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /apply discount/i }));

    await waitFor(() => {
      expect(screen.getByTestId('discount-value-display')).toBeInTheDocument();
    });

    // Type "15"
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '5' }));

    fireEvent.change(screen.getByPlaceholderText(/why discount/i), {
      target: { value: 'Manager comp' },
    });

    // Confirm — triggers PIN modal (15% > 10%)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    // PIN modal appears
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    });

    // Enter 6-digit PIN and click Verify
    enterPin(['1', '2', '3', '4', '5', '6']);

    // verifyFn mock resolves { ok: true, userId: 'mgr-1' }
    await waitFor(() => {
      const state = useCartStore.getState();
      expect(state.cart.cartDiscount?.value).toBe(15);
      expect(state.cart.cartDiscount?.authorized_by).toBe('mgr-1');
    });
  });

  it('wrong PIN: toast "Wrong PIN", PIN modal stays open, cart unchanged', async () => {
    // Override for this test: wrong PIN
    const mod = await import('@/features/discounts/hooks/useVerifyManagerPin');
    vi.spyOn(mod, 'useVerifyManagerPin').mockReturnValue(
      (_pin: string) => Promise.resolve({ ok: false as const, error: 'wrong_pin' as const }),
    );

    const { toast } = await import('sonner');

    render(wrapper(<BottomActionBar />));

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /apply discount/i }));

    await waitFor(() => {
      expect(screen.getByTestId('discount-value-display')).toBeInTheDocument();
    });

    // Type "15" — above threshold
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '5' }));

    fireEvent.change(screen.getByPlaceholderText(/why discount/i), {
      target: { value: 'Manager comp' },
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    // PIN modal appears
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    });

    // Enter 6-digit PIN and click Verify
    enterPin(['1', '2', '3', '4', '5', '6']);

    // Toast error shown
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Wrong PIN');
    });

    // Cart still has no discount
    expect(useCartStore.getState().cart.cartDiscount).toBeUndefined();
  });
});
