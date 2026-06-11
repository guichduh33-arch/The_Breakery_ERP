// packages/domain/src/orders/taxRate.ts
//
// Centralised tax-rate constant for the POS (D5 decision — Session 37 POS-05).
// Business logic reads `business_config.tax_rate` at runtime — that runtime hook
// is deferred to S38. For now every POS site imports this single constant so
// there is one place to update when the rate changes or the hook is wired.
//
// IMPORTANT: this module is IO-free (no fetch, no Supabase, no React) — it lives
// in @breakery/domain which must stay testable without a running server.

/**
 * The default tax rate applied across all POS totals (10 % = PB1 + VAT fold).
 * Replace with a `useTaxRate()` hook reading `business_config` in S38.
 */
export const DEFAULT_TAX_RATE = 0.10;
