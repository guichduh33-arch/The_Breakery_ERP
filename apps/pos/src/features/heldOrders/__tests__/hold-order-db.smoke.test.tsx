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
  // jsdom prompt returns null by default — stub it so the flow proceeds.
  vi.spyOn(window, 'prompt').mockReturnValue('table 5 note');
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

describe('HoldOrderButton (DB-backed)', () => {
  it('holds the current cart via the RPC mutation', async () => {
    render(wrap(<HoldOrderButton />));
    fireEvent.click(screen.getByRole('button', { name: /hold/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const arg = mutateAsync.mock.calls[0]?.[0] as { cartPayload: { items: unknown[] } };
    expect(arg.cartPayload.items.length).toBe(1);
  });

  it('clears the cart after a successful hold', async () => {
    render(wrap(<HoldOrderButton />));
    fireEvent.click(screen.getByRole('button', { name: /hold/i }));
    await waitFor(() => expect(useCartStore.getState().cart.items).toHaveLength(0));
  });
});
