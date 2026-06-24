-- Regression guard for audit 2026-06-25 LOT 2 / U2.
--  (1) journal_entries + journal_entry_lines are append-only at the grant level for
--      authenticated (writes only via SECURITY DEFINER triggers/RPCs).
--  (2) Every journal entry balances (sum(debit) = sum(credit)) and the global ledger
--      is balanced — the 8 orphan sale_refund JE that broke the trial balance are fixed.
--
-- Run via MCP execute_sql (Docker retired): paste between BEGIN/ROLLBACK.

BEGIN;
SELECT plan(7);

SELECT is(has_table_privilege('authenticated','public.journal_entries','INSERT'),     false, 'journal_entries: authenticated cannot INSERT');
SELECT is(has_table_privilege('authenticated','public.journal_entries','UPDATE'),     false, 'journal_entries: authenticated cannot UPDATE');
SELECT is(has_table_privilege('authenticated','public.journal_entries','DELETE'),     false, 'journal_entries: authenticated cannot DELETE');
SELECT is(has_table_privilege('authenticated','public.journal_entry_lines','INSERT'), false, 'journal_entry_lines: authenticated cannot INSERT');

-- No unbalanced journal entry remains.
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT je.id FROM journal_entries je
     LEFT JOIN journal_entry_lines l ON l.journal_entry_id = je.id
     GROUP BY je.id
     HAVING coalesce(sum(l.debit),0) <> coalesce(sum(l.credit),0)
   ) q),
  0, 'no unbalanced journal entry');

-- Global ledger balances.
SELECT is(
  (SELECT coalesce(sum(debit),0) FROM journal_entry_lines),
  (SELECT coalesce(sum(credit),0) FROM journal_entry_lines),
  'global ledger: sum(debit) = sum(credit)');

-- Every sale_refund JE has at least one credit line (fallback guarantees it).
SELECT is(
  (SELECT count(*)::int FROM journal_entries je
   WHERE je.reference_type = 'sale_refund' AND je.total_credit > 0
     AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = je.id AND l.credit > 0)),
  0, 'every sale_refund JE has a credit line');

SELECT * FROM finish();
ROLLBACK;
