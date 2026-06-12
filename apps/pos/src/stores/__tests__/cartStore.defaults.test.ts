// apps/pos/src/stores/__tests__/cartStore.defaults.test.ts
//
// Session 43 / P2-6 — the POS cart defaults to take_out (counter bakery flow).
// D9 : owner to ratify. Regression guard so the default doesn't silently
// drift back to dine_in.

import { describe, it, expect } from 'vitest';
import { useCartStore } from '../cartStore';

describe('cartStore initial state', () => {
  it('defaults order_type to take_out', () => {
    expect(useCartStore.getState().cart.order_type).toBe('take_out');
  });
});
