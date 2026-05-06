// packages/domain/src/discounts/types.ts
// Discount domain types — session 6.
// Spec ref: docs/superpowers/specs/2026-05-06-session-6-discounts-multi-modifiers-loyalty-mult-spec.md §4.1

export interface Discount {
  type: 'percentage' | 'fixed_amount';
  /** pct 0-100 or IDR amount entered */
  value: number;
  /** calculated absolute IDR */
  amount: number;
  /** >= 5 chars */
  reason: string;
  /** user_id if amount/base > threshold */
  authorized_by?: string;
}
