-- S54 P1.3 (T6) — garde fiscale fail-closed (migration 20260710000077)
-- Exécution cloud : envelopper BEGIN…ROLLBACK via MCP execute_sql (capture temp-table).
BEGIN;
SELECT plan(4);

-- 1. Date couverte + open → passe
SELECT lives_ok(
  $$SELECT check_fiscal_period_open('2026-07-02'::date)$$,
  'open period passes');

-- 2. Aucune période couvrante → period_undefined P0004 (fail-closed S54)
SELECT throws_ok(
  $$SELECT check_fiscal_period_open('2031-06-15'::date)$$,
  'P0004', NULL, 'undefined period fails closed');

-- 3. Période closed → period_locked P0004 (comportement historique préservé)
UPDATE fiscal_periods SET status = 'closed'
 WHERE period_start = '2026-01-01';
SELECT throws_ok(
  $$SELECT check_fiscal_period_open('2026-01-15'::date)$$,
  'P0004', NULL, 'closed period still rejected');

-- 4. NULL → P0002 (inchangé)
SELECT throws_ok(
  $$SELECT check_fiscal_period_open(NULL::date)$$,
  'P0002', NULL, 'null date rejected');

SELECT finish();
ROLLBACK;
