// packages/domain/src/inventory/validateTransfer.ts
// Session 12 — Phase 3 — pure validators for the stock-transfer flow.
//
// Mirrors the server-side checks in `create_transfer_v1` / `receive_transfer_v1`.
// Server remains authoritative — these validators are for fast client-side feedback
// before the round-trip. IO-free.

import type {
  TransferInput,
  TransferReceiveInput,
} from './types.js';

/** Failure codes returned by `validateTransferInput`. */
export type ValidateTransferCode =
  | 'from_to_same_section'
  | 'items_required'
  | 'duplicate_product_in_items'
  | 'quantity_must_be_positive'
  | 'product_id_required';

/** Failure codes returned by `validateTransferReceive`. */
export type ValidateTransferReceiveCode =
  | 'received_items_required'
  | 'item_id_required'
  | 'quantity_received_invalid' // qty_received < 0 or qty_received > requested
  | 'duplicate_item_in_received';

/**
 * Local discriminated-union result.
 *
 * Note: distinct from the `ValidationResult` exported by `./types.ts`
 * (which uses `{ ok, error }`). Transfer validators carry typed codes
 * and an optional `detail` payload (e.g. the offending id) — kept local
 * to avoid breaking the existing `ok/error` shape consumed by
 * `validateAdjust` / `validateReceive` / `validateWaste`.
 */
export type ValidationResult<C extends string> =
  | { valid: true }
  | { valid: false; code: C; detail?: string };

/**
 * Pre-flight checks for `create_transfer_v1`.
 *
 * Validation order (first failure short-circuits):
 *   1. `from_section_id !== to_section_id`
 *   2. `items` is a non-empty array
 *   3. each item has a truthy `product_id`
 *   4. each item has a positive numeric `quantity`
 *   5. no duplicate `product_id` across items
 */
export function validateTransferInput(
  input: TransferInput,
): ValidationResult<ValidateTransferCode> {
  if (input.from_section_id === input.to_section_id) {
    return { valid: false, code: 'from_to_same_section' };
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { valid: false, code: 'items_required' };
  }

  const seen = new Set<string>();
  for (const it of input.items) {
    if (!it.product_id) {
      return { valid: false, code: 'product_id_required' };
    }
    if (
      it.quantity === undefined ||
      it.quantity === null ||
      it.quantity <= 0
    ) {
      return { valid: false, code: 'quantity_must_be_positive', detail: it.product_id };
    }
    if (seen.has(it.product_id)) {
      return { valid: false, code: 'duplicate_product_in_items', detail: it.product_id };
    }
    seen.add(it.product_id);
  }
  return { valid: true };
}

/**
 * Pre-flight checks for `receive_transfer_v1`.
 *
 * `requested` maps `item_id → originally-requested quantity`, sourced from
 * the open transfer document. Each received quantity must satisfy
 * `0 ≤ qty_received ≤ requested[item_id]`.
 *
 * Validation order (first failure short-circuits):
 *   1. `items` is a non-empty array
 *   2. each item has a truthy `item_id`
 *   3. no duplicate `item_id`
 *   4. each `item_id` is present in `requested` and the qty fits the range
 */
export function validateTransferReceive(
  input: TransferReceiveInput,
  requested: Map<string /* item_id */, number /* requested qty */>,
): ValidationResult<ValidateTransferReceiveCode> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { valid: false, code: 'received_items_required' };
  }

  const seen = new Set<string>();
  for (const it of input.items) {
    if (!it.item_id) {
      return { valid: false, code: 'item_id_required' };
    }
    if (seen.has(it.item_id)) {
      return { valid: false, code: 'duplicate_item_in_received', detail: it.item_id };
    }
    seen.add(it.item_id);

    const req = requested.get(it.item_id);
    if (req === undefined) {
      // unknown item — treat as invalid quantity
      return { valid: false, code: 'quantity_received_invalid', detail: it.item_id };
    }
    if (it.quantity_received < 0 || it.quantity_received > req) {
      return { valid: false, code: 'quantity_received_invalid', detail: it.item_id };
    }
  }
  return { valid: true };
}
