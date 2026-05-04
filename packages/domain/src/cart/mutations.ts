// packages/domain/src/cart/mutations.ts
import type { Cart, CartItem, Product } from '../types/index.js';

export function addItem(cart: Cart, product: Product, quantity = 1): Cart {
  const existing = cart.items.find((i) => i.product_id === product.id);
  if (existing) {
    return {
      ...cart,
      items: cart.items.map((i) =>
        i.product_id === product.id ? { ...i, quantity: i.quantity + quantity } : i,
      ),
    };
  }
  const newItem: CartItem = {
    product_id: product.id,
    name: product.name,
    unit_price: product.retail_price,
    quantity,
  };
  return { ...cart, items: [...cart.items, newItem] };
}

export function updateQuantity(cart: Cart, productId: string, quantity: number): Cart {
  if (quantity <= 0) return removeItem(cart, productId);
  const found = cart.items.some((i) => i.product_id === productId);
  if (!found) return cart;
  return {
    ...cart,
    items: cart.items.map((i) =>
      i.product_id === productId ? { ...i, quantity } : i,
    ),
  };
}

export function removeItem(cart: Cart, productId: string): Cart {
  return { ...cart, items: cart.items.filter((i) => i.product_id !== productId) };
}

export function clearCart(cart: Cart): Cart {
  return { ...cart, items: [] };
}

export function setOrderType(cart: Cart, orderType: Cart['order_type']): Cart {
  return { ...cart, order_type: orderType };
}
