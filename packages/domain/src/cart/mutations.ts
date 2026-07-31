// packages/domain/src/cart/mutations.ts
// Session 47: addComboItem added — mirrors addItem but always sets product_type='combo'
// and carries the resolved combo_components snapshot.
import type { Cart, CartItem, ComboComponent, Product } from '../types/index.js';
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
 * Signature of a configured combo line: the line signature, plus the component
 * configuration. Components are sorted so their order never splits a line, and
 * each carries its own modifier signature (ADR-017) so two combos differing only
 * by a component's answer stay on two lines.
 */
function comboSignature(
  productId: string,
  modifiers: SelectedModifiers,
  components: ComboComponent[],
): string {
  const comps = components
    .map((c) => `${c.product_id}x${c.quantity}@${modifierSignature(c.modifiers ?? [])}`)
    .sort()
    .join(',');
  return `${lineSignature(productId, modifiers)}::${comps}`;
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
  // D11 (session 8 perf-debt): single-pass map with `merged` flag instead of
  // `find()` then `map()` (two passes). The flag preserves first-match
  // semantics — only the first item whose signature matches receives the
  // increment, even if multiple items share the same signature.
  const sig = lineSignature(product.id, modifiers);
  let merged = false;
  const nextItems = cart.items.map((i) => {
    if (!merged && lineSignature(i.product_id, i.modifiers) === sig) {
      merged = true;
      return { ...i, quantity: i.quantity + quantity };
    }
    return i;
  });
  if (merged) return { ...cart, items: nextItems };

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

/**
 * Session 47 — add a configured combo line to the cart.
 * Mirrors `addItem` but always sets `product_type='combo'` and attaches the
 * resolved `combo_components` snapshot so the cart display and server payload
 * can show (and deduct stock for) the chosen component products.
 *
 * Merge semantics: two taps of the same combo with identical modifier selections
 * (same chosen options → same line signature) stack into one line, same as
 * `addItem`. Distinct configurations create separate lines.
 */
export function addComboItem(
  cart: Cart,
  product: Product,
  modifiers: SelectedModifiers,
  components: ComboComponent[],
  quantity = 1,
  unitPriceOverride?: number,
): Cart {
  // Combos merge on the same product + chosen options + component configuration.
  //
  // ADR-017 — the component configuration is part of the signature: "Capuccino
  // Hot" and "Capuccino Iced" pick the SAME combo option, so a signature built
  // on the line's modifiers alone would stack them into one line of quantity 2
  // and the kitchen would prepare a single drink.
  const sig = comboSignature(product.id, modifiers, components);
  let merged = false;
  const nextItems = cart.items.map((i) => {
    if (!merged && comboSignature(i.product_id, i.modifiers, i.combo_components ?? []) === sig) {
      merged = true;
      return { ...i, quantity: i.quantity + quantity };
    }
    return i;
  });
  if (merged) return { ...cart, items: nextItems };

  const newItem: CartItem = {
    id: newLineId(),
    product_id: product.id,
    name: product.name,
    unit_price: unitPriceOverride ?? product.retail_price,
    quantity,
    modifiers,
    product_type: 'combo',
    combo_components: components,
  };
  return { ...cart, items: [...cart.items, newItem] };
}

export function updateQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  if (quantity <= 0) return removeItem(cart, lineId);
  // D11 (session 8 perf-debt): merge the existence check (`some`) and the
  // mutation (`map`) into a single pass via a `touched` flag. If no item
  // matches we return the original cart unchanged (same reference) — keeps
  // the existing "no-op when id not found" contract.
  let touched = false;
  const nextItems = cart.items.map((i) => {
    if (i.id === lineId) {
      touched = true;
      return { ...i, quantity };
    }
    return i;
  });
  if (!touched) return cart;
  return { ...cart, items: nextItems };
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
