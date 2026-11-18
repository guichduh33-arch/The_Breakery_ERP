// Postgres enum values, re-exported from the generated types.
// Source unique = Postgres (AGENTS.md) : aucune liste n'est recopiée à la main.
// Le miroir manuel omettait des valeurs (statuts de commande, type `b2b`,
// mouvements de stock, `refund` de fidélité) ; il dérive désormais de
// `Constants`, régénéré avec `types.generated.ts` à chaque changement de schéma.
import { Constants } from './types.generated.js';

const E = Constants.public.Enums;

/** `orders.order_type` — channel from which the order originated. */
export const ORDER_TYPES = E.order_type;

/** `order_payments.payment_method` — tender accepted at the POS. */
export const PAYMENT_METHODS = E.payment_method;

/** `pos_sessions.status` — open shifts accept sales; closed shifts are read-only. */
export const SHIFT_STATUSES = E.shift_status;

/** `orders.status` — order lifecycle statuses. */
export const ORDER_STATUSES = E.order_status;

/** `stock_movements.movement_type` — ledger event classifications. */
export const MOVEMENT_TYPES = E.movement_type;

/** `customers.customer_type` — segments retail walk-ins from B2B accounts. */
export const CUSTOMER_TYPES = E.customer_type;

/** `loyalty_transactions.txn_type` — loyalty ledger event types. */
export const LOYALTY_TXN_TYPES = E.loyalty_txn_type;
