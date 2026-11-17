-- supabase/tests/coa_company_chart.test.sql
-- Charte de comptes de la société (20261117000002) et bilan v5 (20261117000003).
--
-- Vérifie : les comptes de la charte existent avec leur classe et leur section
-- de flux ; les codes du système gardent leur sens (2210, 3200, 4900) ; les
-- nouvelles catégories de dépenses pointent vers une charge ; le bilan v5 range
-- une immobilisation et un prêt consenti dans l'actif sans casser l'équilibre.
-- Assertions en DELTA : la base dev porte de vraies écritures.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

DO $fixture$
DECLARE v_auth UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'reports.financial.read')
   ORDER BY (up.role_code = 'SUPER_ADMIN') DESC, up.created_at LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
END $fixture$;

-- Comptes de la charte
SELECT is(
  (SELECT count(*)::int FROM accounts WHERE is_active AND is_postable AND code IN (
    '1400','1410','1450','1460','1600','1610','1690','2200','2250','2300','2400','2990',
    '3310','4140','4950','5120','5300','6110','6120','6350','6400','6450','6600','6810',
    '6950','6960','7100','7110')),
  28, 'COA_01 — the 28 new company accounts exist, active and postable');
SELECT is(
  (SELECT string_agg(code, ',' ORDER BY code) FROM accounts
    WHERE code IN ('1600','1610','1690') AND cash_flow_section = 'investing'),
  '1600,1610', 'COA_02 — fixed assets are investing, accumulated depreciation is not');
SELECT is(
  (SELECT string_agg(code, ',' ORDER BY code) FROM accounts
    WHERE code IN ('1450','2200','2250','2300','3310') AND cash_flow_section = 'financing'),
  '1450,2200,2250,2300,3310', 'COA_03 — loans, shareholder loan and debt, dividends are financing');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM accounts WHERE code IN ('1400','1410','1450','1460','1600','1610','1690')
               AND cash_flow_section = 'none'),
  'COA_04 — no new asset is flagged as a cash account');
SELECT is(
  (SELECT account_class::int FROM accounts WHERE code = '7100'), 4,
  'COA_05 — financial income 7100 is a revenue (class 4) account');
SELECT is(
  (SELECT cash_flow_section::text FROM accounts WHERE code = '1690'), 'operating',
  'COA_05b — accumulated depreciation follows its operating depreciation expense');
SELECT is(
  (SELECT balance_type FROM accounts WHERE code = '1690'), 'credit',
  'COA_06 — accumulated depreciation carries a credit balance');

-- Codes du système inchangés
SELECT is(
  (SELECT account_code FROM accounting_mappings WHERE mapping_key = 'LOYALTY_LIABILITY'), '2210',
  'COA_07 — 2210 still holds the loyalty liability');
SELECT is(
  (SELECT account_code FROM accounting_mappings WHERE mapping_key = 'SALE_DISCOUNT'), '4900',
  'COA_08 — 4900 still holds sales discounts');
SELECT ok(
  (SELECT account_class = 3 AND balance_type = 'credit' AND is_postable AND is_active
     FROM accounts WHERE code = '3200'),
  'COA_09 — 3200 is still a postable credit equity account (year-end close target)');

-- Catégories de dépenses
SELECT is(
  (SELECT count(*)::int FROM expense_categories c JOIN accounts a ON a.id = c.account_id
    WHERE c.code IN ('BPJS','MANAGEMENT_COMP','WASTE_COLLECTION','TELECOM','SOFTWARE',
                     'PROFESSIONAL_FEES','LOAN_INTEREST')
      AND c.is_active AND a.account_class = 6 AND a.is_active AND a.is_postable),
  7, 'COA_10 — the 7 new expense categories route to an active expense account');

-- Bilan v5
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_balance_sheet_v5(date)', 'EXECUTE'),
  'COA_11 — anon cannot execute get_balance_sheet_v5');

DO $baseline$
DECLARE v JSONB := get_balance_sheet_v5(CURRENT_DATE);
BEGIN
  PERFORM set_config('coa.fixed_before', v->'assets'->'fixed'->>'total', true);
  PERFORM set_config('coa.other_before', v->'assets'->'current'->>'other', true);
  PERFORM set_config('coa.delta_before', v->>'delta', true);
END $baseline$;

DO $seed$
DECLARE v_je UUID;
BEGIN
  INSERT INTO journal_entries(entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit)
    VALUES ('PGTAP-COA-1', CURRENT_DATE, 'equipment bought', 'manual', gen_random_uuid(), 'posted', 1000, 1000)
    RETURNING id INTO v_je;
  INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit) VALUES
    (v_je, (SELECT id FROM accounts WHERE code = '1600'), 1000, 0),
    (v_je, (SELECT id FROM accounts WHERE code = '1110'), 0, 1000);

  INSERT INTO journal_entries(entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit)
    VALUES ('PGTAP-COA-2', CURRENT_DATE, 'loan to shareholder', 'manual', gen_random_uuid(), 'posted', 500, 500)
    RETURNING id INTO v_je;
  INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit) VALUES
    (v_je, (SELECT id FROM accounts WHERE code = '1450'), 500, 0),
    (v_je, (SELECT id FROM accounts WHERE code = '1110'), 0, 500);
END $seed$;

SELECT is(
  ((get_balance_sheet_v5(CURRENT_DATE))->'assets'->'fixed'->>'total')::NUMERIC
    - current_setting('coa.fixed_before')::NUMERIC,
  1000::NUMERIC, 'COA_12 — a 1600 entry lands in fixed assets');
SELECT is(
  ((get_balance_sheet_v5(CURRENT_DATE))->'assets'->'current'->>'other')::NUMERIC
    - current_setting('coa.other_before')::NUMERIC,
  500::NUMERIC, 'COA_13 — a 1450 entry lands in other current assets');
SELECT is(
  ((get_balance_sheet_v5(CURRENT_DATE))->>'delta')::NUMERIC,
  current_setting('coa.delta_before')::NUMERIC,
  'COA_14 — the balance check does not move when new asset accounts are used');

SELECT * FROM finish();
ROLLBACK;
