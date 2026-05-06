// packages/domain/src/combos/types.ts
//
// Combo domain types — session 7.
// V1 combos are fixed (no component choice groups).
// Spec ref: docs/superpowers/specs/2026-05-06-session-7-customer-categories-combos-spec.md §1 CB1–CB5
import type { Product } from '../types/index.js';

/** Row from the `combo_items` table. */
export interface ComboItem {
  parent_product_id: string;
  component_product_id: string;
  quantity: number;
  sort_order: number;
}

/** Assembled view of a combo product together with its resolved components. */
export interface ComboWithComponents {
  combo: Product;
  components: {
    product: Product;
    quantity: number;
    sort_order: number;
  }[];
}
