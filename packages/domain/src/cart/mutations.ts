// packages/domain/src/cart/mutations.ts
import type { Cart, CartItem, Product } from '../types/index.js';
import type { SelectedModifiers } from '../modifiers/types.js';

/**
 * Stable signature used to detect "same line" merges:
 * a product+modifier-set tuple. Order-independent on modifiers (sorted by
 * group_name then option_label).
 */
function modifierSignature(modifiers: SelectedModifiers): string {
  const sorted = [...modifiers].sort((a, b) => {
    const ga = a.group_name.localeCompare(b.group_name);
    return ga !== 0 ? ga : a.option_label.localeCompare(b.option_label);
  });
  return sorted.map((m) => `${m.group_name}::${m.option_label}`).join('|');
}

function lineSignature(productId: string, modifiers: SelectedModifiers): string {
  return `${productId}#${modifierSignature(modifiers)}`;
}

/**
 * Generate a new line id. Falls back to a timestamp+random id when
 * `crypto.randomUUID` is unavailable (e.g. older test environments).
 */
function newLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cart-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function addItem(
  cart: Cart,
  product: Product,
  modifiers: SelectedModifiers = [],
  quantity = 1,
  unitPriceOverride?: number,
): Cart {
  const sig = lineSignature(product.id, modifiers);
  const existing = cart.items.find(
    (i) => lineSignature(i.product_id, i.modifiers) === sig,
  );
  if (existing) {
    return {
      ...cart,
      items: cart.items.map((i) =>
        i.id === existing.id ? { ...i, quantity: i.quantity + quantity } : i,
      ),
    };
  }
  const newItem: CartItem = {
    id: newLineId(),
    product_id: product.id,
    name: product.name,
    unit_price: unitPriceOverride ?? product.retail_price,
    quantity,
    modifiers,
    ...(product.product_type !== 'finished' ? { product_type: product.product_type } : {}),
  };
  return { ...cart, items: [...cart.items, newItem] };
}

export function updateQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  if (quantity <= 0) return removeItem(cart, lineId);
  const found = cart.items.some((i) => i.id === lineId);
  if (!found) return cart;
  return {
    ...cart,
    items: cart.items.map((i) =>
      i.id === lineId ? { ...i, quantity } : i,
    ),
  };
}

export function removeItem(cart: Cart, lineId: string): Cart {
  return { ...cart, items: cart.items.filter((i) => i.id !== lineId) };
}

export function clearCart(cart: Cart): Cart {
  return { ...cart, items: [] };
}

export function setOrderType(cart: Cart, orderType: Cart['order_type']): Cart {
  return { ...cart, order_type: orderType };
}

export function attachCustomer(cart: Cart, customerId: string): Cart {
  return { ...cart, customerId };
}

export function detachCustomer(cart: Cart): Cart {
  const { customerId: _c, loyaltyPointsToRedeem: _l, ...rest } = cart;
  return rest;
}

export function setRedeemPoints(cart: Cart, points: number): Cart {
  return { ...cart, loyaltyPointsToRedeem: points };
}
