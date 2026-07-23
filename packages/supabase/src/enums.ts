// Mirror of Postgres enum types declared in supabase/migrations/*_init_*.sql.
// Keep in sync with the database on schema changes.

/** `orders.order_type` — channel from which the order originated. */
export const ORDER_TYPES = ['dine_in', 'take_out', 'delivery'] as const;

/** `order_payments.payment_method` — tender accepted at the POS.
 *  gopay/ovo/dana (lot B ADR-006 déc. 9) settle like QRIS. */
export const PAYMENT_METHODS = ['cash', 'card', 'qris', 'edc', 'transfer', 'store_credit', 'gopay', 'ovo', 'dana'] as const;

/** `pos_sessions.status` — open shifts accept sales; closed shifts are read-only. */
export const SHIFT_STATUSES = ['open', 'closed'] as const;

/** `orders.status` — `draft` is editable, `paid` is final-with-payments, `voided` is reversed. */
export const ORDER_STATUSES = ['draft', 'paid', 'voided'] as const;

/** `stock_movements.movement_type` — ledger event classifications. */
export const MOVEMENT_TYPES = ['sale', 'sale_void', 'production', 'purchase', 'waste', 'adjustment'] as const;

/** `customers.customer_type` — segments retail walk-ins from B2B accounts. */
export const CUSTOMER_TYPES = ['retail', 'b2b'] as const;

/** `loyalty_transactions.txn_type` — earn at sale, redeem on demand, adjust for corrections. */
export const LOYALTY_TXN_TYPES = ['earn', 'redeem', 'adjust'] as const;
