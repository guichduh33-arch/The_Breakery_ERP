// apps/pos/src/features/cart/__tests__/send-to-kitchen-holds.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as CartStoreModule from '@/stores/cartStore';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fireMutate, holdMutate, resetTerminal } = vi.hoisted(() => ({
  fireMutate: vi.fn().mockResolvedValue([{ role: 'barista', ok: true, itemIds: ['l1'] }]),
  holdMutate: vi.fn().mockResolvedValue(undefined),
  resetTerminal: vi.fn(),
}));

vi.mock('../hooks/useFireToStations', () => ({
  useFireToStations: () => ({
    mutation: { mutateAsync: fireMutate, isPending: false },
    firableCount: 1,
    unroutedCount: 0,
  }),
}));
vi.mock('../hooks/useHoldFiredOrder', () => ({
  useHoldFiredOrder: () => ({ mutateAsync: holdMutate, isPending: false }),
}));
vi.mock('@/stores/cartStore', async (orig) => {
  const mod = await orig<typeof CartStoreModule>();
  return { ...mod, resetCartAfterCheckout: resetTerminal };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { SendToKitchenButton } from '../SendToKitchenButton';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';

function wrap(n: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Critique run 4 lot 8 — shift-gate (décision C du 2026-08-15) : l'envoi en
  // cuisine ne part plus sans session de caisse. Le scénario testé ici — parquer
  // la commande APRÈS l'envoi — suppose une session ouverte (comme les fire-*).
  useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });
  useCartStore.setState({
    cart: { items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 1, modifiers: [] }], order_type: 'dine_in', tableNumber: 'T-01' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: 'order-99', appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('SendToKitchenButton — hold after send', () => {
  it('holds the fired order then clears the terminal', async () => {
    render(wrap(<SendToKitchenButton />));
    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));
    await waitFor(() => expect(fireMutate).toHaveBeenCalled());
    await waitFor(() => expect(holdMutate).toHaveBeenCalledWith('order-99'));
    await waitFor(() => expect(resetTerminal).toHaveBeenCalled());
  });
});
