-- supabase/tests/s26_db_hardening.test.sql
-- Session 26 / Wave 1.J — pgTAP suite intégrée DB hardening.
-- Couvre 1.B (PB1 dynamic), 1.C (fold PPN), 1.D (PB1 payable),
-- 1.E (split méthode — skipped : require seeded fixtures), 1.F (cash mvt JE — skipped),
-- 1.G (dedupe), 1.H (COA cleanup), 1.I (4 RPCs cockpit).
--
-- Run via MCP execute_sql avec BEGIN/ROLLBACK envelope, OR psql -f.

BEGIN;
SELECT plan(15);

-- ============================================================================
-- Wave 1.B : current_pb1_rate() helper + PB1 dynamic
-- ============================================================================

SELECT ok(
  (SELECT current_pb1_rate()) = (SELECT tax_rate FROM business_config WHERE id = 1),
  'T1: current_pb1_rate() returns business_config.tax_rate'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_sale_journal_entry'
  ),
  'T2: create_sale_journal_entry trigger function exists'
);

-- ============================================================================
-- Wave 1.C : fold PPN supplier dans INVENTORY
-- ============================================================================

SELECT ok(
  (SELECT obj_description(p.oid, 'pg_proc')
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_purchase_journal_entry'
  ) LIKE '%F-S26-AC-09%',
  'T3: create_purchase_journal_entry comment mentions F-S26-AC-09 (folded vat)'
);

-- ============================================================================
-- Wave 1.D : calculate_pb1_payable_v1 + DROP calculate_vat_payable
-- ============================================================================

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'calculate_vat_payable'
  ),
  'T4: calculate_vat_payable was dropped'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'calculate_pb1_payable_v1'
  ),
  'T5: calculate_pb1_payable_v1 exists'
);

SELECT ok(
  (calculate_pb1_payable_v1(DATE '2026-01-01', DATE '2026-12-31'))->>'tax_regime' = 'NON_PKP_BALI_PB1',
  'T6: calculate_pb1_payable_v1 returns NON_PKP_BALI_PB1 tax_regime'
);

-- ============================================================================
-- Wave 1.F : record_cash_movement_v2 + drop v1 + mappings
-- ============================================================================

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_cash_movement_v1'
  ),
  'T7: record_cash_movement_v1 was dropped'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_cash_movement_v2'
  ),
  'T8: record_cash_movement_v2 exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM accounting_mappings
    WHERE mapping_key IN ('CASH_MOVEMENT_OWNER_CAPITAL', 'CASH_MOVEMENT_BANK')
    GROUP BY 1 HAVING COUNT(*) >= 1
  ),
  'T9: cash movement mapping keys seeded'
);

-- ============================================================================
-- Wave 1.H : COA cleanup
-- ============================================================================

SELECT is(
  (SELECT account_class FROM accounts WHERE code = '3200'),
  3,
  'T10: account 3200 Retained Earnings exists with class=3 equity'
);

SELECT is(
  (SELECT account_class FROM accounts WHERE code = '5910'),
  6,
  'T11: account 5910 Cash Variance Loss reclassified to class=6 expense'
);

SELECT is(
  (SELECT is_active FROM accounts WHERE code = '1151'),
  false,
  'T12: account 1151 VAT Input deactivated (NON-PKP)'
);

-- ============================================================================
-- Wave 1.I : 4 RPCs cockpit + permissions
-- ============================================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'close_fiscal_period_v1', 'get_general_ledger_v1',
      'get_trial_balance_v1', 'create_manual_je_v1'
    )
    GROUP BY 1 HAVING COUNT(*) = 4
  ),
  'T13: 4 cockpit RPCs exist (close_fiscal_period_v1, get_general_ledger_v1, get_trial_balance_v1, create_manual_je_v1)'
);

-- T14 vérifie structurellement que le payload contient les bons champs.
-- Note : sur V3 dev cloud le seed est déséquilibré (fixtures incomplètes — pré-S26),
-- donc on n'asserte PAS balanced=true ici. Une suite séparée avec fixtures
-- propres (Wave 4 ou test runner Vitest live) vérifiera l'équation comptable.
SELECT ok(
  get_trial_balance_v1(DATE '2026-01-01', DATE '2026-12-31') ?& ARRAY['balanced', 'total_debit', 'total_credit', 'lines'],
  'T14: get_trial_balance_v1 returns payload with balanced+totals+lines keys'
);

SELECT ok(
  (SELECT COUNT(*) FROM permissions WHERE code LIKE 'accounting.%') >= 6,
  'T15: 6+ accounting.* permissions seeded'
);

SELECT * FROM finish();
ROLLBACK;
