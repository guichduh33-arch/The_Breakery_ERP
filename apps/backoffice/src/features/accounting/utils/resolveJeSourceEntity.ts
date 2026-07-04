// apps/backoffice/src/features/accounting/utils/resolveJeSourceEntity.ts
//
// Session 59 / Task 6a — maps a journal_entries.reference_type (canonical
// vocabulary, see journal_entries_reference_type_check in
// 20260710000080_create_close_fiscal_year_v1.sql) to the DrilldownEntity + id
// used to link back to the originating operation. Reuses the existing
// buildDrilldownUrl/DrilldownLink infra (reports feature) instead of
// recoding routes.
//
// Unmapped reference_types (purchase*, shift_close, adjustment, waste,
// opname, production, transfer, manual, pos_outstanding*, stock_movement,
// year_close, sale_refund, refund) return null — callers fall back to
// plain text, same as the pre-Task-6a behaviour.
//
// Review finding (I-1) — sale_refund/refund deliberately excluded from
// ORDER_REFERENCE_TYPES: for these two reference_types,
// journal_entries.reference_id is a `refunds.id`, NOT an `orders.id` (see
// the trigger fn_create_je_for_refund, migrations 20260512000005 /
// 20260517000013: `INSERT INTO journal_entries (..., reference_id) VALUES
// (..., NEW.id)` where NEW is the `refunds` row being inserted — the order
// id is only looked up separately, for the description). Mapping these to
// `order` would build /orders/<refund_uuid>, a 404. A real fix needs a
// refunds→order id lookup (join at read time) — out of scope here.

import type { DrilldownEntity } from '@/features/reports/utils/buildDrilldownUrl.js';

const ORDER_REFERENCE_TYPES = new Set(['sale', 'sale_void', 'void']);
const EXPENSE_REFERENCE_TYPES = new Set(['expense', 'expense_payment']);
const B2B_REFERENCE_TYPES = new Set([
  'b2b_order',
  'b2b_payment',
  'b2b_adjustment',
  'b2b_order_cancel',
]);

export interface JeSourceTarget {
  entity: DrilldownEntity;
  id: string;
}

export function resolveJeSourceEntity(
  referenceType: string | null,
  referenceId: string | null,
): JeSourceTarget | null {
  if (referenceType === null) return null;
  if (ORDER_REFERENCE_TYPES.has(referenceType)) {
    return { entity: 'order', id: referenceId ?? '' };
  }
  if (EXPENSE_REFERENCE_TYPES.has(referenceType)) {
    return { entity: 'expense', id: referenceId ?? '' };
  }
  if (B2B_REFERENCE_TYPES.has(referenceType)) {
    return { entity: 'b2b_invoices', id: '' };
  }
  if (referenceType === 'cash_movement') {
    return { entity: 'cash_treasury', id: '' };
  }
  return null;
}
