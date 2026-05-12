// packages/domain/src/inventory/types.ts
// Session 12 — inventory MVP domain types.
//
// Mirrors the `stock_movement_type` enum and `record_stock_movement` RPC contract.
// All types are IO-free and serialisable.

/** Matches the `stock_movement_type` enum in the DB (session 12 migration). */
export type MovementType =
  | 'sale'
  | 'sale_void'
  | 'production'
  | 'purchase'
  | 'waste'
  | 'adjustment';

/** Reference table for tracing the source of a movement. */
export type StockMovementReferenceType =
  | 'order'
  | 'order_item'
  | 'adjustment'
  | 'purchase'
  | 'waste'
  | 'production'
  | 'manual';

/** A stock movement row as exposed to UI / domain layer. */
export interface StockMovement {
  id: string;
  productId: string;
  movementType: MovementType;
  /** Signed delta. Positive = stock IN, negative = stock OUT. */
  quantity: number;
  reason?: string;
  /** Unit cost recorded at purchase time (used for COGS / valuation). */
  unitCost?: number;
  supplierId?: string;
  /** Client-supplied dedup key for idempotent retries (UUID v4 recommended). */
  idempotencyKey?: string;
  referenceType: StockMovementReferenceType;
  referenceId?: string;
  createdBy: string;
  createdAt: string;
}

/** Aggregated stock level row (denormalised join from `products` + recent movement). */
export interface StockLevel {
  productId: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  currentStock: number;
  minStockThreshold: number;
  lastMovementAt: string | null;
}

/** Input for the manual adjustment flow (set new absolute stock). */
export interface AdjustmentInput {
  productId: string;
  /** Absolute target qty (NOT a delta). Must be >= 0. */
  newQty: number;
  reason: string;
  idempotencyKey?: string;
}

/** Input for the receive-stock-from-supplier flow. */
export interface ReceiveInput {
  productId: string;
  /** Positive quantity to add to stock. */
  quantity: number;
  supplierId: string;
  /** Optional COGS-time unit cost. */
  unitCost?: number;
  reason?: string;
  idempotencyKey?: string;
}

/** Input for the waste / shrinkage flow. */
export interface WasteInput {
  productId: string;
  /** Positive quantity to remove from stock. */
  quantity: number;
  reason: string;
  idempotencyKey?: string;
  /** Caller-supplied current stock for pre-flight insufficient-stock check. */
  currentStock: number;
}

/** Discriminated union returned by every validator. */
export type ValidationResult<T = void> =
  | { ok: true; value?: T }
  | { ok: false; error: string };

/**
 * Shape of the JSONB returned by the three RPC wrappers
 * (`adjust_stock`, `receive_stock`, `record_waste`).
 *
 * - `movement_id` is `null` on idempotent replays where no new row was inserted.
 * - `noop` is true when the adjustment delta resolved to 0.
 */
export interface StockMovementRpcResult {
  movement_id: string | null;
  product_id: string;
  new_current_stock: number;
  idempotent_replay?: boolean;
  noop?: boolean;
}
