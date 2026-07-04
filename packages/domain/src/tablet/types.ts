import type { CartItem } from '../types/cart.js';

export type { CartItem };

export interface TabletCart {
  items: CartItem[];
  tableNumber: string | null;
  orderType: 'dine_in' | 'take_out';
  /**
   * Session 59 (17 D1.1) — order-level free-text note (allergy, "no gluten"...).
   * Optional so existing cart literals (tests, preview-only call-sites) don't
   * need to be touched; `buildSubmitPayload` treats a missing note as null.
   */
  notes?: string | null;
}

export interface TabletOrderEntry {
  id: string;
  order_number: string;
  table_number: string | null;
  order_type: 'dine_in' | 'take_out';
  waiter_id: string;
  waiter_name: string;
  sent_to_kitchen_at: string;
  items_count: number;
  items_total: number;
  /** Session 59 (17 D1.1) — order-level note surfaced on the pickup/inbox row. */
  notes: string | null;
}
