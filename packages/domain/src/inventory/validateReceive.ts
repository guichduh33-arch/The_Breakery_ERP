// packages/domain/src/inventory/validateReceive.ts
// Session 12 — pure validator for the receive-stock-from-supplier flow.
// Mirrors the server-side checks in receive_stock RPC. Server is authoritative.

import type { ReceiveInput, ValidationResult } from './types.js';

export function validateReceive(input: ReceiveInput): ValidationResult {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: 'quantity_must_be_positive' };
  }
  if (!input.supplierId) {
    return { ok: false, error: 'supplier_required' };
  }
  if (input.unitCost !== undefined && (!Number.isFinite(input.unitCost) || input.unitCost < 0)) {
    return { ok: false, error: 'negative_unit_cost' };
  }
  // Reason is optional, but if provided it must be meaningful.
  if (input.reason !== undefined && input.reason.trim().length > 0 && input.reason.trim().length < 3) {
    return { ok: false, error: 'reason_too_short' };
  }
  return { ok: true };
}
