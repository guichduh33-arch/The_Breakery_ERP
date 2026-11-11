-- S3-15 — Un compte de charge par nature de dépense.
--
-- Transport, assurance, taxes, frais bancaires et bureau tombaient tous sur
-- `6190` « autres charges » : le compte de résultat ne distinguait rien.
--
-- 1. Cinq comptes de charge, mêmes attributs que leurs voisins 611x.
-- 2. Chaque catégorie vise son compte. « Other » garde 6190 : elle le mérite.
--
-- Une catégorie DÉJÀ utilisée par une dépense garde son compte : c'est la
-- règle en vigueur (`expense_category_account_in_use`), et les écritures
-- passées ne sont pas réécrites (règle forward-only du module). Relevé en
-- production le 2026-11-11 : seule « Office » est dans ce cas (2 dépenses,
-- 896 926,14 IDR sur 6190). Son sort attend un arbitrage.

INSERT INTO accounts (code, name, account_class, account_type, balance_type,
                      is_postable, is_system, is_active, cash_flow_section) VALUES
  ('6118', 'Transport & Delivery', 6, 'expense', 'debit', true, true, true, 'operating'),
  ('6119', 'Insurance',            6, 'expense', 'debit', true, true, true, 'operating'),
  ('6121', 'Taxes & Licenses',     6, 'expense', 'debit', true, true, true, 'operating'),
  ('6122', 'Bank Charges',         6, 'expense', 'debit', true, true, true, 'operating'),
  ('6123', 'Office Expenses',      6, 'expense', 'debit', true, true, true, 'operating')
ON CONFLICT (code) DO NOTHING;

UPDATE expense_categories c
   SET account_id = a.id
  FROM (VALUES ('TRANSPORT', '6118'),
               ('INSURANCE', '6119'),
               ('TAX',       '6121'),
               ('BANK_FEES', '6122'),
               ('OFFICE',    '6123')) AS m(category_code, account_code)
  JOIN accounts a ON a.code = m.account_code
 WHERE c.code = m.category_code
   AND c.account_id IS DISTINCT FROM a.id
   AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.category_id = c.id);
