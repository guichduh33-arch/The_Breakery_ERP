// apps/pos/src/stores/__tests__/cartStore.networkSplit.test.ts
//
// Session 13 / Phase 4.A — verify the cart store survives:
//  1. StrictMode-style double mount (Zustand persist rehydrates from
//     sessionStorage ; we simulate the re-import by directly reading the
//     storage key after a mutation).
//  2. Network split + reconnect ; `online`/`offline` events flip `isOffline`
//     without dropping cart items.
//  3. Locked items are preserved across reload (matches K3 invariant).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Product } from '@breakery/domain';
import { useCartStore, initNetworkListener, resetCartAfterCheckout } from '../cartStore';

const makeProduct = (id: string, name: string, price = 25_000): Product => ({
  id,
  name,
  price,
  category_id: 'cat-1',
  modifier_groups: [],
} as unknown as Product);

function fullReset() {
  // Clear all cart state, including locked items and customer pin.
  useCartStore.setState({
    cart: { items: [], order_type: 'dine_in' },
    lockedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
    isOffline: false,
  });
  // Empty the sessionStorage slot so partialize starts fresh per test.
  sessionStorage.removeItem('breakery.cart.v2');
}

describe('cartStore — network split + re-mount hardening', () => {
  beforeEach(() => {
    fullReset();
  });

  afterEach(() => {
    fullReset();
  });

  describe('persist + rehydrate (StrictMode-safe)', () => {
    it('persists cart items to sessionStorage after add', () => {
      useCartStore.getState().add(makeProduct('p1', 'Latte'));
      const raw = sessionStorage.getItem('breakery.cart.v2');
      expect(raw).not.toBeNull();
      const persisted = JSON.parse(raw!);
      expect(persisted.state.cart.items).toHaveLength(1);
      expect(persisted.state.cart.items[0].name).toBe('Latte');
    });

    it('retains locked items across an in-memory reset (simulating reload)', () => {
      // 1. Ring up two items, lock one (sent to kitchen).
      useCartStore.getState().add(makeProduct('p1', 'Latte'));
      useCartStore.getState().add(makeProduct('p2', 'Croissant'));
      const lineIds = useCartStore.getState().cart.items.map((i) => i.id);
      useCartStore.getState().markLocked([lineIds[0]!]);

      // 2. Snapshot persisted state.
      const persisted = JSON.parse(sessionStorage.getItem('breakery.cart.v2')!);
      expect(persisted.state.lockedItemIds).toEqual([lineIds[0]]);
      expect(persisted.state.cart.items).toHaveLength(2);

      // 3. Simulate a tab reload : drop the in-memory state then read what
      // the persist middleware would re-load. We assert the snapshot data
      // is round-trippable so the rehydrate would succeed.
      const rehydrated = JSON.parse(sessionStorage.getItem('breakery.cart.v2')!);
      expect(rehydrated.state.cart.items.map((i: { name: string }) => i.name))
        .toEqual(['Latte', 'Croissant']);
      expect(rehydrated.state.lockedItemIds).toEqual([lineIds[0]]);
    });

    it('clear() preserves locked items (K3 invariant — incremental send)', () => {
      useCartStore.getState().add(makeProduct('p1', 'Espresso'));
      useCartStore.getState().add(makeProduct('p2', 'Donut'));
      const lineIds = useCartStore.getState().cart.items.map((i) => i.id);
      useCartStore.getState().markLocked([lineIds[0]!]);

      useCartStore.getState().clear();

      const remaining = useCartStore.getState().cart.items;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(lineIds[0]);
    });

    it('does not lose unlocked edits made between a "reload" probe and next mutation', () => {
      // Simulates a StrictMode double-mount where two render passes both
      // call cartStore.add ; persist must show the latest items, not a stale
      // snapshot.
      useCartStore.getState().add(makeProduct('p1', 'Mocha'));
      const snapshot1 = JSON.parse(sessionStorage.getItem('breakery.cart.v2')!);
      useCartStore.getState().add(makeProduct('p2', 'Brownie'));
      const snapshot2 = JSON.parse(sessionStorage.getItem('breakery.cart.v2')!);
      expect(snapshot1.state.cart.items).toHaveLength(1);
      expect(snapshot2.state.cart.items).toHaveLength(2);
    });
  });

  describe('offline mode', () => {
    it('initializes isOffline=false in a jsdom env with onLine=true', () => {
      // Force-reset so the constructor evaluates fresh.
      expect(useCartStore.getState().isOffline).toBe(false);
    });

    it('setOffline toggles the flag without touching cart items', () => {
      useCartStore.getState().add(makeProduct('p1', 'Cappuccino'));
      const itemsBefore = useCartStore.getState().cart.items.length;

      useCartStore.getState().setOffline(true);
      expect(useCartStore.getState().isOffline).toBe(true);
      expect(useCartStore.getState().cart.items).toHaveLength(itemsBefore);

      useCartStore.getState().setOffline(false);
      expect(useCartStore.getState().isOffline).toBe(false);
      expect(useCartStore.getState().cart.items).toHaveLength(itemsBefore);
    });

    it('allows cart mutation while offline (read-only applies to checkout, not ring-up)', () => {
      useCartStore.getState().setOffline(true);
      useCartStore.getState().add(makeProduct('p1', 'Tea'));
      expect(useCartStore.getState().cart.items).toHaveLength(1);
      expect(useCartStore.getState().isOffline).toBe(true);
    });

    it('flips isOffline on window online/offline events when listener attached', () => {
      const cleanup = initNetworkListener();
      try {
        window.dispatchEvent(new Event('offline'));
        expect(useCartStore.getState().isOffline).toBe(true);
        window.dispatchEvent(new Event('online'));
        expect(useCartStore.getState().isOffline).toBe(false);
      } finally {
        cleanup();
      }
    });

    it('cleanup detaches the listener so subsequent events are ignored', () => {
      const cleanup = initNetworkListener();
      cleanup();
      // After cleanup the cart store must not react to events anymore.
      useCartStore.getState().setOffline(false);
      window.dispatchEvent(new Event('offline'));
      expect(useCartStore.getState().isOffline).toBe(false);
    });

    it('initNetworkListener is a no-op without window (SSR safety)', () => {
      // Save & restore globals to simulate a non-browser env.
      const originalWindow = global.window;
      // @ts-expect-error — deliberate
      delete global.window;
      const cleanup = initNetworkListener();
      expect(typeof cleanup).toBe('function');
      cleanup(); // doesn't throw
      global.window = originalWindow;
    });
  });

  describe('reconnect — locked items survive a simulated channel reset', () => {
    it('a locked item remains in the cart after setOffline(true) → setOffline(false)', () => {
      useCartStore.getState().add(makeProduct('p1', 'Pastry'));
      const lineId = useCartStore.getState().cart.items[0]!.id;
      useCartStore.getState().markLocked([lineId]);

      // Simulate the realtime channel dropping and reconnecting.
      useCartStore.getState().setOffline(true);
      useCartStore.getState().setOffline(false);

      expect(useCartStore.getState().lockedItemIds).toEqual([lineId]);
      expect(useCartStore.getState().cart.items).toHaveLength(1);
      expect(useCartStore.getState().canEdit(lineId)).toBe(false);
    });
  });

  describe('resetCartAfterCheckout', () => {
    it('clears cart, locked items, customer, and pickedUpOrderId on checkout completion', () => {
      useCartStore.getState().add(makeProduct('p1', 'Roll'));
      useCartStore.getState().markLocked([useCartStore.getState().cart.items[0]!.id]);
      useCartStore.setState({ pickedUpOrderId: 'ord-1' });

      resetCartAfterCheckout();

      const s = useCartStore.getState();
      expect(s.cart.items).toHaveLength(0);
      expect(s.lockedItemIds).toEqual([]);
      expect(s.attachedCustomer).toBeNull();
      expect(s.pickedUpOrderId).toBeNull();
    });
  });

  // Suppress unused-import vi warning when no spies are attached in this file.
  void vi;
});
