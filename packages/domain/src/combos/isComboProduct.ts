// packages/domain/src/combos/isComboProduct.ts
import type { Product } from '../types/index.js';

/**
 * Type guard that returns true when the given product (or partial product)
 * has product_type === 'combo'.
 *
 * Accepts a Pick so callers can pass lightweight query results without
 * needing the full Product shape.
 */
export function isComboProduct(p: Pick<Product, 'product_type'>): boolean {
  return p.product_type === 'combo';
}
