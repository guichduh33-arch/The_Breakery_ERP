// packages/domain/src/inventory/validateWaste.ts
// Session 12 — pure validator for the waste / shrinkage flow.
// Mirrors the server-side checks in record_waste RPC. Server is authoritative.

import type { WasteInput, ValidationResult } from './types.js';

export function validateWaste(input: WasteInput): ValidationResult {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: 'quantity_must_be_positive' };
  }
  if (input.quantity > input.currentStock) {
    return { ok: false, error: 'insufficient_stock' };
  }
  if (!input.reason || input.reason.trim().length < 3) {
    return { ok: false, error: 'reason_required' };
  }
  return { ok: true };
}
