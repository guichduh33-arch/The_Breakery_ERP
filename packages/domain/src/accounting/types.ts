// packages/domain/src/accounting/types.ts
//
// Session 13 / Phase 1.A — TS mirror of the accounting_mappings seed.
// MappingKey is the canonical symbolic ID used by JE triggers / RPCs.
// SQL seed lives in `supabase/migrations/20260517000001_init_accounting_mappings.sql`
// and `20260517000005_seed_full_coa_sak_emkm.sql`.
//
// Pure TS. No IO, no Supabase, no React (packages/domain rule).

/**
 * 24 canonical mapping keys for the SAK-EMKM Chart of Accounts.
 * Adding a key here is a code-side hint ONLY — the SQL seed is the source of truth.
 * Drift detection : pgTAP test T_MAPPING_KEYS_TS_MATCH verifies parity.
 */
export const MAPPING_KEYS = [
  // Sales — payment channels
  'SALE_PAYMENT_CASH',
  'SALE_PAYMENT_QRIS',
  'SALE_PAYMENT_DEBIT',
  'SALE_PAYMENT_CREDIT_CARD',
  // Sales — revenue / tax / discount
  'SALE_POS_REVENUE',
  'SALE_B2B_REVENUE',
  'SALE_PB1_TAX',
  'SALE_DISCOUNT',
  'LOYALTY_LIABILITY',
  // Purchases
  'PURCHASE_PAYABLE',
  'PURCHASE_VAT_INPUT',
  'PURCHASE_CASH_OUT',
  // Inventory
  'INVENTORY_GENERAL',
  'INVENTORY_RAW_MATERIAL',
  'INVENTORY_FINISHED_GOODS',
  // Production / waste / adjustments
  'PRODUCTION_COGS',
  'WASTE_EXPENSE',
  'ADJUSTMENT_INCOME',
  'ADJUSTMENT_EXPENSE',
  'OPNAME_INCOME',
  'OPNAME_EXPENSE',
  // Expenses / B2B / shift
  'EXPENSE_DEFAULT',
  'B2B_AR',
  'SHIFT_CASH_VARIANCE_INCOME',
  'SHIFT_CASH_VARIANCE_EXPENSE',
] as const;

export type MappingKey = (typeof MAPPING_KEYS)[number];

/** Returns true if `s` is a known accounting mapping key. */
export function isMappingKey(s: string): s is MappingKey {
  return (MAPPING_KEYS as readonly string[]).includes(s);
}

/**
 * The 17-value canonical `reference_type` set on journal_entries.
 * 2 legacy aliases (`void`, `refund`) are tolerated by the DB CHECK during
 * the V2→V3 transition (D13) but new code must emit the canonical values.
 */
export const REFERENCE_TYPES_CANONICAL = [
  'sale',
  'sale_void',
  'sale_refund',
  'purchase',
  'purchase_return',
  'purchase_payment',
  'expense',
  'expense_payment',
  'shift_close',
  'adjustment',
  'waste',
  'opname',
  'production',
  'transfer',
  'manual',
  'pos_outstanding',
  'pos_outstanding_payment',
  'stock_movement',
] as const;

export type ReferenceTypeCanonical = (typeof REFERENCE_TYPES_CANONICAL)[number];

/** Returns true if `s` is a canonical reference_type. */
export function isCanonicalReferenceType(s: string): s is ReferenceTypeCanonical {
  return (REFERENCE_TYPES_CANONICAL as readonly string[]).includes(s);
}

/**
 * Fiscal-period status machine. JE creation blocks on closed/locked.
 * `draft` is reserved for initial setup ; `open` is the steady state ;
 * `closed` allows reopening (admin) ; `locked` is permanent (audit / tax submitted).
 */
export const FISCAL_PERIOD_STATUSES = ['draft', 'open', 'closed', 'locked'] as const;
export type FiscalPeriodStatus = (typeof FISCAL_PERIOD_STATUSES)[number];

/** A fiscal period is editable if status is in this set. */
export function isFiscalPeriodEditable(status: FiscalPeriodStatus): boolean {
  return status === 'draft' || status === 'open';
}
