// apps/pos/src/__tests__/held-orders.smoke.test.tsx
//
// ADR-022 déc. 4 — les trois smokes du parcage de panier (HoldOrderButton →
// hold_order_v1 : payload, toast, bouton désactivé sur panier vide) sont
// retirées avec la mécanique qu'elles couvraient : on ne met plus en attente
// qu'une commande DÉJÀ envoyée en cuisine. Ce parcours-là est couvert par
// `features/cart/__tests__/rehold-fired-order.smoke.test.tsx`.
//
// Ne subsiste ici que l'assertion de remise à zéro du panier après encaissement,
// qui n'a jamais eu de rapport avec le hold.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';

import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';

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
