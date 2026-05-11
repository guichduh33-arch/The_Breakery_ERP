// packages/domain/src/inventory/validateAdjust.ts
// Session 12 — pure validator for the manual adjustment flow.
// Mirrors the server-side checks in adjust_stock RPC. Server is authoritative.

import type { AdjustmentInput, ValidationResult } from './types.js';

export function validateAdjust(input: AdjustmentInput): ValidationResult {
  if (!Number.isFinite(input.newQty) || input.newQty < 0) {
    return { ok: false, error: 'negative_qty_not_allowed' };
  }
  if (!input.reason || input.reason.trim().length < 3) {
    return { ok: false, error: 'reason_required' };
  }
  return { ok: true };
}
