// apps/pos/src/features/payment/split/types.ts
//
// Shared types for the split-payment flow (Session 14 / Phase 2.C, refs
// 90-95). The flow ships a multi-tender array to the existing checkout
// RPC (one tender per payer), so we never bypass `complete_order_with_
// payment` / `pay_existing_order`. The only addition vs. standard cash
// flow is the per-payer item assignment that drives each payer's subtotal.

import type { PaymentMethod } from '@breakery/domain';

/** Split mode: how amounts are divided among payers. */
export type SplitMode = 'items' | 'equal' | 'custom';

/** A single payer in the flow. */
export interface SplitPayer {
  /** Stable id : "client-1", "client-2", etc. */
  id: string;
  /** 1-indexed label : "Client 1", "Client 2", ... */
  label: string;
  /** Tailwind class for the colored dot in the label chip. */
  color: 'blue' | 'green' | 'orange' | 'purple' | 'pink';
  /** Items assigned to this payer (CartItem id + quantity). */
  items: SplitAssignment[];
  /** Selected payment method (null until the cashier picks one). */
  method: PaymentMethod | null;
  /** Cash received raw input (only used when method === 'cash'). */
  cashReceivedStr: string;
  /** Marks this payer as "paid in the per-payer step" (confirm pressed). */
  confirmed: boolean;
  /**
   * Pre-assigned amount for equal/custom modes only.
   * When set, this overrides the item-based subtotal for this payer.
   */
  assignedAmount?: number;
}

/** Item assignment row : pointer back to a cart line + quantity assigned. */
export interface SplitAssignment {
  /** Cart item id (the line being split). */
  cartItemId: string;
  /** How many units of that line go to this payer. */
  quantity: number;
}

/** Flow steps. */
export type SplitStep =
  | 'mode_select'      // S38 POS-15 — "How do you want to split?"
  | 'payer_count'      // ref 90 / 92 — "How many payers?"
  | 'custom_amounts'   // S38 POS-15 — per-payer amount entry (custom mode)
  | 'assign_items'     // ref 91 / 93 — left list + per-payer tab assignment
  | 'per_payer_method' // ref 94 — per-payer method picker
  | 'per_payer_cash';  // ref 95 — per-payer cash numpad

/** Color rotation for payer chips — matches the screenshot palette. */
export const PAYER_COLORS: SplitPayer['color'][] = ['blue', 'green', 'orange', 'purple', 'pink'];

/** Build N empty payers. */
export function makePayers(count: number): SplitPayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `client-${i + 1}`,
    label: `Client ${i + 1}`,
    color: PAYER_COLORS[i % PAYER_COLORS.length]!,
    items: [],
    method: null,
    cashReceivedStr: '',
    confirmed: false,
  }));
}

/** Tailwind classes per payer color. Used for chip + total color in the UI. */
export const COLOR_CLASSES: Record<SplitPayer['color'], { text: string; bg: string; border: string; dot: string }> = {
  blue:   { text: 'text-blue-400',   bg: 'bg-blue-400/10',   border: 'border-blue-400/60',   dot: 'bg-blue-400' },
  green:  { text: 'text-green',      bg: 'bg-green/10',      border: 'border-green/60',      dot: 'bg-green' },
  orange: { text: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/60', dot: 'bg-orange-400' },
  purple: { text: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/60', dot: 'bg-purple-400' },
  pink:   { text: 'text-pink-400',   bg: 'bg-pink-400/10',   border: 'border-pink-400/60',   dot: 'bg-pink-400' },
};
