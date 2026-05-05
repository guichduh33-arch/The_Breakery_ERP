// NOTE: Cart.tableNumber is not yet on the Cart type (added by integration agent in session 4).
// HeldOrder.cart.tableNumber is a separate snapshot field. When building from a Cart, callers
// must pass tableNumber explicitly via opts. fromHeldOrder returns a Cart without tableNumber
// (the integration agent will reconcile once Cart is extended).

import type { Cart } from '../types/cart.js';
import type { HeldOrder } from './types.js';

export interface ToHeldOrderOpts {
  id?: string;
  notes?: string;
  tableNumber?: string | null;
  orderType?: 'dine_in' | 'take_out';
}

export function toHeldOrder(cart: Cart, opts: ToHeldOrderOpts = {}): HeldOrder {
  const base: HeldOrder = {
    id: opts.id ?? crypto.randomUUID(),
    heldAt: new Date().toISOString(),
    cart: {
      items: cart.items.map((item) => ({ ...item, modifiers: [...item.modifiers] })),
      customerId: cart.customerId ?? null,
      loyaltyPointsToRedeem: cart.loyaltyPointsToRedeem ?? 0,
      orderType: opts.orderType ?? (cart.order_type === 'dine_in' ? 'dine_in' : 'take_out'),
      tableNumber: opts.tableNumber ?? null,
    },
  };
  if (opts.notes !== undefined) {
    base.notes = opts.notes;
  }
  return base;
}

export function fromHeldOrder(held: HeldOrder): Cart {
  const cart: Cart = {
    items: held.cart.items.map((item) => ({ ...item, modifiers: [...item.modifiers] })),
    order_type: held.cart.orderType,
    loyaltyPointsToRedeem: held.cart.loyaltyPointsToRedeem,
  };
  if (held.cart.customerId !== null) {
    cart.customerId = held.cart.customerId;
  }
  return cart;
}
