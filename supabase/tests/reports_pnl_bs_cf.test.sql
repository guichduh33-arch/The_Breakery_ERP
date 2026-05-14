-- supabase/tests/reports_pnl_bs_cf.test.sql
-- Session 13 / Phase 6.A — pgTAP suite (T_RPT_FIN_01..12) for the 4 new
-- financial / market-basket report RPCs.
--
-- Pattern: BEGIN ... ROLLBACK envelope so this file leaves no state.
-- Seeds three journal entries:
--   JE1 : $100 cash sale  (Dr 1110 100, Cr 4100 100)
--   JE2 : $40 COGS        (Dr 5110  40, Cr 1141  40)
--   JE3 : $20 rent paid   (Dr 6112  20, Cr 1110  20)
-- Expected derivations (gross/net/balanced) tested below.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

-- ============================================================
-- T_RPT_FIN_01..04 — RPC existence
-- ============================================================
SELECT has_function(
  'public', 'get_profit_loss_v1', ARRAY['date','date','uuid'],
  'T_RPT_FIN_01 — get_profit_loss_v1 exists'
);
SELECT has_function(
  'public', 'get_balance_sheet_v1', ARRAY['date'],
  'T_RPT_FIN_02 — get_balance_sheet_v1 exists'
);
SELECT has_function(
  'public', 'get_cash_flow_v1', ARRAY['date','date'],
  'T_RPT_FIN_03 — get_cash_flow_v1 exists'
);
SELECT has_function(
  'public', 'get_basket_analysis_v1', ARRAY['date','date','integer'],
  'T_RPT_FIN_04 — get_basket_analysis_v1 exists'
);

-- ============================================================
-- Seed data
-- ============================================================
DO $seed$
DECLARE
  v_cash  UUID;
  v_rev   UUID;
  v_cogs  UUID;
  v_inv   UUID;
  v_rent  UUID;
  v_je    UUID;
BEGIN
  SELECT id INTO v_cash FROM accounts WHERE code='1110';
  SELECT id INTO v_rev  FROM accounts WHERE code='4100';
  SELECT id INTO v_cogs FROM accounts WHERE code='5110';
  SELECT id INTO v_inv  FROM accounts WHERE code='1141';
  SELECT id INTO v_rent FROM accounts WHERE code='6112';

  INSERT INTO journal_entries(entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit)
    VALUES ('PGTAP-FIN-1', CURRENT_DATE, 'cash sale', 'manual', gen_random_uuid(), 'posted', 100, 100)
    RETURNING id INTO v_je;
  INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit) VALUES
    (v_je, v_cash, 100, 0),
    (v_je, v_rev,  0,   100);

  INSERT INTO journal_entries(entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit)
    VALUES ('PGTAP-FIN-2', CURRENT_DATE, 'cogs', 'manual', gen_random_uuid(), 'posted', 40, 40)
    RETURNING id INTO v_je;
  INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit) VALUES
    (v_je, v_cogs, 40, 0),
    (v_je, v_inv,  0,  40);

  INSERT INTO journal_entries(entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit)
    VALUES ('PGTAP-FIN-3', CURRENT_DATE, 'rent', 'manual', gen_random_uuid(), 'posted', 20, 20)
    RETURNING id INTO v_je;
  INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit) VALUES
    (v_je, v_rent, 20, 0),
    (v_je, v_cash, 0,  20);
END $seed$;

-- ============================================================
-- T_RPT_FIN_05..07 — P&L math
-- ============================================================
SELECT is(
  ((get_profit_loss_v1(CURRENT_DATE, CURRENT_DATE))->'revenue'->>'total')::NUMERIC,
  100::NUMERIC,
  'T_RPT_FIN_05 — P&L revenue total = 100'
);
SELECT is(
  ((get_profit_loss_v1(CURRENT_DATE, CURRENT_DATE))->'cogs'->>'total')::NUMERIC,
  40::NUMERIC,
  'T_RPT_FIN_06 — P&L COGS total = 40'
);
SELECT is(
  ((get_profit_loss_v1(CURRENT_DATE, CURRENT_DATE))->>'net_profit')::NUMERIC,
  40::NUMERIC,
  'T_RPT_FIN_07 — P&L net profit = 100 - 40 - 20 = 40'
);

-- ============================================================
-- T_RPT_FIN_08..09 — Balance Sheet math + balanced
-- ============================================================
SELECT is(
  ((get_balance_sheet_v1(CURRENT_DATE))->'equity'->>'current_year_earnings')::NUMERIC,
  40::NUMERIC,
  'T_RPT_FIN_08 — Balance Sheet CYE = net profit = 40'
);
SELECT ok(
  ((get_balance_sheet_v1(CURRENT_DATE))->>'balanced')::BOOLEAN,
  'T_RPT_FIN_09 — Balance Sheet is balanced (A = L + E + CYE)'
);

-- ============================================================
-- T_RPT_FIN_10..11 — Cash Flow shape (investing/financing zero)
-- ============================================================
SELECT is(
  ((get_cash_flow_v1(CURRENT_DATE, CURRENT_DATE))->'investing'->>'total')::NUMERIC,
  0::NUMERIC,
  'T_RPT_FIN_10 — Cash Flow investing = 0 (MVP placeholder)'
);
SELECT is(
  ((get_cash_flow_v1(CURRENT_DATE, CURRENT_DATE))->'financing'->>'total')::NUMERIC,
  0::NUMERIC,
  'T_RPT_FIN_11 — Cash Flow financing = 0 (MVP placeholder)'
);

-- ============================================================
-- T_RPT_FIN_12 — Basket analysis runs on empty window
-- ============================================================
SELECT lives_ok(
  $$SELECT * FROM public.get_basket_analysis_v1(CURRENT_DATE, CURRENT_DATE, 10)$$,
  'T_RPT_FIN_12 — get_basket_analysis_v1 runs without error on empty window'
);

SELECT * FROM finish();
ROLLBACK;
