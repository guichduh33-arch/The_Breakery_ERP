-- S1-17 et S3-15 — comptes de taxe hors régime réservés, et un compte de
-- charge par nature de dépense.
--
-- Runner : MCP execute_sql (enveloppe BEGIN … ROLLBACK), pas de runner local.
BEGIN;
SELECT plan(9);

-- S1-17 --------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.accounts
            WHERE code IN ('2142','2143') AND NOT is_active AND NOT is_postable),
  2, 'both out-of-regime tax accounts are inactive and not postable');
SELECT is((SELECT count(*)::int FROM public.accounting_mappings WHERE account_code IN ('2142','2143')),
  0, 'no mapping targets them');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines l
            JOIN public.accounts a ON a.id = l.account_id WHERE a.code IN ('2142','2143')),
  0, 'they carry no journal line');
SELECT ok((SELECT is_active AND is_postable FROM public.accounts WHERE code = '2110'),
  'the local restaurant tax account stays live');
-- Même si un mapping les visait un jour, la résolution le refuse.
INSERT INTO public.accounting_mappings(mapping_key, account_code, description, is_active)
VALUES ('PGTAP_RESERVED_TAX','2142','pgTAP reserved tax fixture',true);
SELECT throws_ok($q$ SELECT public.resolve_mapping_account('PGTAP_RESERVED_TAX') $q$,
  'P0002', NULL, 'a mapping pointed at a reserved tax account does not resolve');

-- S3-15 --------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM public.accounts
            WHERE code IN ('6118','6119','6121','6122','6123')
              AND account_class = 6 AND account_type = 'expense' AND balance_type = 'debit'
              AND is_active AND is_postable AND deleted_at IS NULL
              AND cash_flow_section = 'operating'),
  5, 'the five expense accounts exist, postable, in the operating section');
SELECT is((SELECT count(*)::int
             FROM (VALUES ('TRANSPORT','6118'),('INSURANCE','6119'),('TAX','6121'),
                          ('BANK_FEES','6122'),('OFFICE','6123')) AS m(category_code, account_code)
             JOIN public.expense_categories c ON c.code = m.category_code
             JOIN public.accounts a ON a.id = c.account_id
            WHERE a.code <> m.account_code
              AND NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.category_id = c.id)),
  0, 'every unused category targets the account of its nature');
SELECT is((SELECT count(*)::int FROM public.expense_categories c JOIN public.accounts a ON a.id = c.account_id
            WHERE c.code = 'OTHER' AND a.code <> '6190'),
  0, 'the catch-all category keeps the other-expenses account');
SELECT is((SELECT count(*)::int FROM public.expense_categories c JOIN public.accounts a ON a.id = c.account_id
            WHERE a.code = '6190' AND c.code IN ('TRANSPORT','INSURANCE','TAX','BANK_FEES')
              AND NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.category_id = c.id)),
  0, 'no unused category of a named nature still falls on other expenses');

SELECT * FROM finish();
ROLLBACK;
