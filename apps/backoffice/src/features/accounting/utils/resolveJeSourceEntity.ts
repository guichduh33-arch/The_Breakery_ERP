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
// year_close) return null — callers fall back to plain text, same as the
// pre-Task-6a behaviour.

import type { DrilldownEntity } from '@/features/reports/utils/buildDrilldownUrl.js';

const ORDER_REFERENCE_TYPES = new Set(['sale', 'sale_void', 'sale_refund', 'void', 'refund']);
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
