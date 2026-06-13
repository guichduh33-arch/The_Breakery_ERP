// apps/pos/src/__tests__/held-orders.smoke.test.tsx
//
// Session 35 (F-003) — rewritten for the DB-backed hold flow. The old
// localStorage `heldOrdersStore` is retired; hold/restore/discard now go
// through `hold_order_v1` / `restore_held_order_v1` / `discard_held_order_v1`.
// These smokes assert the UI wiring (HoldOrderButton fires the mutation with
// the live cart and clears it) and the still-valid checkout reset behavior.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const holdMutateAsync = vi.fn().mockResolvedValue('order-1');
vi.mock('@/features/heldOrders/hooks/useHoldOrder', () => ({
  useHoldOrder: () => ({ mutateAsync: holdMutateAsync, isPending: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { HoldOrderButton } from '@/features/heldOrders/components/HoldOrderButton';
import { toast } from 'sonner';

const ITEM = { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 2, modifiers: [] };

function wrap(node: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

/** S43 P2-2 — drives the hold-note modal (window.prompt is retired). */
function holdViaModal(note?: string) {
  fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
  if (note !== undefined) {
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), { target: { value: note } });
  }
  fireEvent.click(screen.getByTestId('hold-note-confirm'));
}

describe('held-orders smoke — DB-backed hold flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.setState({
      cart: { items: [ITEM], order_type: 'dine_in', tableNumber: 'T-03' },
      lockedItemIds: [],
      attachedCustomer: null,
    } as never);
  });

  it('holds the cart: mutation fires with the cart payload + table, then cart clears', async () => {
    render(wrap(<HoldOrderButton />));
    holdViaModal('for Mr. Tan');

    await waitFor(() => expect(holdMutateAsync).toHaveBeenCalled());
    const arg = holdMutateAsync.mock.calls[0]?.[0] as {
      cartPayload: { items: unknown[]; order_type: string };
      tableNumber: string | null;
      notes: string | null;
    };
    expect(arg.cartPayload.items).toHaveLength(1);
    expect(arg.cartPayload.order_type).toBe('dine_in');
    expect(arg.tableNumber).toBe('T-03');
    expect(arg.notes).toBe('for Mr. Tan');

    await waitFor(() => expect(useCartStore.getState().cart.items).toHaveLength(0));
  });

  it('toasts success after hold', async () => {
    render(wrap(<HoldOrderButton />));
    holdViaModal();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Held'));
  });

  it('does not fire the mutation when the cart is empty', () => {
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
    } as never);
    render(wrap(<HoldOrderButton />));
    // Button is disabled when the cart is empty.
    const btn = screen.getByRole('button', { name: /^hold$/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(holdMutateAsync).not.toHaveBeenCalled();
  });
});

describe('resetCartAfterCheckout clears tableNumber', () => {
  it('tableNumber is cleared on checkout reset', () => {
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in', tableNumber: 'T-03' },
      lockedItemIds: [],
      attachedCustomer: null,
    } as never);
    resetCartAfterCheckout();
    expect(useCartStore.getState().cart.tableNumber).toBeUndefined();
  });
});
