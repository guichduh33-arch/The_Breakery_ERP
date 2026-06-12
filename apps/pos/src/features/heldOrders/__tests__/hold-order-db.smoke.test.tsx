/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mutateAsync = vi.fn().mockResolvedValue('order-1');
vi.mock('../hooks/useHoldOrder', () => ({ useHoldOrder: () => ({ mutateAsync, isPending: false }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HoldOrderButton } from '../components/HoldOrderButton';
import { useCartStore } from '@/stores/cartStore';

function wrap(n: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: {
      items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
    },
    lockedItemIds: [],
    printedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set(),
    isOffline: false,
  } as never);
});

/** S43 P2-2 — drives the hold-note modal (window.prompt is retired). */
function holdViaModal(note?: string) {
  fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
  if (note !== undefined) {
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), { target: { value: note } });
  }
  fireEvent.click(screen.getByTestId('hold-note-confirm'));
}

describe('HoldOrderButton (DB-backed)', () => {
  it('holds the current cart via the RPC mutation', async () => {
    render(wrap(<HoldOrderButton />));
    holdViaModal('table 5 note');
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const arg = mutateAsync.mock.calls[0]?.[0] as { cartPayload: { items: unknown[] }; notes: string | null };
    expect(arg.cartPayload.items.length).toBe(1);
    expect(arg.notes).toBe('table 5 note');
  });

  it('clears the cart after a successful hold', async () => {
    render(wrap(<HoldOrderButton />));
    holdViaModal();
    await waitFor(() => expect(useCartStore.getState().cart.items).toHaveLength(0));
  });
});
