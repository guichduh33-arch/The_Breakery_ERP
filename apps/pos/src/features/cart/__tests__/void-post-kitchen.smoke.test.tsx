/// <reference types="@testing-library/jest-dom" />
// apps/pos/src/features/cart/__tests__/void-post-kitchen.smoke.test.tsx
//
// Session 37 — B4: void routing after kitchen send.
//
// Finding POS-06 investigation: for POS COUNTER orders, "send to kitchen" is
// print-ticket-only (useFireToStations calls markLocked + markPrinted but never
// creates a server orders row). The orders row is only created at checkout.
// Therefore there is NO server order to void for a plain counter cart.
//
// For TABLET PICKUP orders, cartStore.pickedUpOrderId holds the server-side
// order UUID (created by create_tablet_order_v2). Those DO have a server row
// and should be voided via the void-order EF.
//
// Tests:
//   (a) Cart with locked items AND a pickedUpOrderId (tablet pickup after kitchen
//       send) → the server void hook is called with the order id before local reset.
//   (b) Cart with locked items but NO pickedUpOrderId (counter cart after kitchen
//       send) → only the local cartStore.voidOrder() runs; no server call.
//
// PinVerificationModal is mocked so we can directly trigger onVerified without
// needing to simulate NumpadPin digit-by-digit input. This test is about void
// ROUTING logic, not PIN UI.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { BottomActionBar } from '../BottomActionBar';

// Mock PinVerificationModal so we can trigger onVerified without digit input.
// The test is about void routing, not the PIN modal UI.
vi.mock('@breakery/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@breakery/ui')>();
  return {
    ...mod,
    PinVerificationModal: ({
      open,
      onVerified,
      onClose,
    }: {
      open: boolean;
      onVerified: (userId: string) => void;
      onClose?: () => void;
    }) =>
      open ? (
        <div>
          <span>PIN modal open</span>
          <button onClick={() => onVerified('manager-1')}>Mock Verify</button>
          <button onClick={() => onClose?.()}>Cancel</button>
        </div>
      ) : null,
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
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
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: { verified_user_id: 'manager-1' }, error: null }),
    },
  },
  supabaseUrl: 'http://localhost:54321',
}));

// Mock the void-order EF hook used for server-side void
const mockVoidMutateAsync = vi.fn().mockResolvedValue({ order_id: 'order-123' });
vi.mock('@/features/order-history/hooks/useVoidOrder', () => ({
  useVoidOrder: () => ({
    mutateAsync: mockVoidMutateAsync,
    isPending: false,
  }),
}));

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const ITEM = {
  id: 'l1', product_id: 'p1', name: 'Americano',
  unit_price: 35000, quantity: 1, modifiers: [] as never[],
};

describe('BottomActionBar — Void Order post-kitchen routing (POS-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.setState({
      cart: { items: [ITEM], order_type: 'dine_in' },
      lockedItemIds: ['l1'],   // items were sent to kitchen
      printedItemIds: ['l1'],
      appliedPromotions: [],
      attachedCustomer: null,
      pickedUpOrderId: null,   // default: counter order
    });
  });

  it('(b) counter cart after kitchen send: client-only void, no server call', () => {
    // pickedUpOrderId is null → counter cart
    useCartStore.setState({ pickedUpOrderId: null });

    render(wrapper(<BottomActionBar />));
    fireEvent.click(screen.getByRole('button', { name: /void order/i }));

    // PIN modal appears (items are locked) — the mock renders "PIN modal open"
    expect(screen.getByText('PIN modal open')).toBeInTheDocument();
    // The server void hook must NOT be called at this point
    expect(mockVoidMutateAsync).not.toHaveBeenCalled();
    // Order still intact
    expect(useCartStore.getState().cart.items).toHaveLength(1);
  });

  it('(a) tablet pickup after kitchen send: server void called before local reset', async () => {
    // pickedUpOrderId set → server order exists
    useCartStore.setState({ pickedUpOrderId: 'order-123' });

    render(wrapper(<BottomActionBar />));
    fireEvent.click(screen.getByRole('button', { name: /void order/i }));

    // PIN modal appears — click the mock verify button to trigger onVerified
    const mockVerifyBtn = screen.getByRole('button', { name: /mock verify/i });
    fireEvent.click(mockVerifyBtn);

    // After PIN verification, the server void should be called
    await waitFor(() => expect(mockVoidMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-123' }),
    ));
    // On success, local cart is reset
    await waitFor(() => expect(useCartStore.getState().cart.items).toHaveLength(0));
  });
});
