// apps/backoffice/src/features/orders/types.ts
// Session 33 / Wave 2.1 — shared types for the edit-items + filters flow.
// ADR-010 — locked (kitchen-sent) lines carry is_locked; a locked update is a
// qty DECREASE under manager authorization + mandatory waste on the delta.

export interface OrderEditDiff {
  removes: string[];                                          // order_item_ids
  updates: Array<{ order_item_id: string; qty: number; is_locked?: boolean }>;
  adds:    Array<{ product_id: string; qty: number; modifiers?: unknown }>;
}

export interface OrderItemEdit {
  id:            string;
  product_id:    string;
  name_snapshot: string;
  qty:           number;
  unit_price:    number;
  line_total:    number;
  modifiers:     unknown[];
  /** ADR-010 — true once the line was sent to kitchen (KOT emitted). */
  is_locked:     boolean;
}
