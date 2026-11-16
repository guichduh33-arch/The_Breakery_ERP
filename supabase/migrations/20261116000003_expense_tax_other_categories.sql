-- Catégories « Tax » et « Other » absentes de la production V3.
--
-- `20260517000120_init_expenses.sql` les pose, et dev les porte. Relevé en
-- production le 2026-11-16 : les catégories y datent du 2026-10-30, sans
-- `TAX` ni `OTHER`, et aucune ligne d'`audit_logs` ne trace leur suppression.
-- Elles n'y ont donc jamais été créées. Demande de Mamat du 2026-11-16 : les
-- ajouter.
--
-- Chacune vise le compte de sa nature, comme sur dev : `TAX` → 6121
-- (`20261111000013`), `OTHER` → 6190, qu'elle mérite. Rejouable : sans effet
-- là où la catégorie existe déjà, dev compris.

INSERT INTO expense_categories (code, name, account_id, is_active)
SELECT m.code, m.name, a.id, true
  FROM (VALUES ('TAX',   'Tax',   '6121'),
               ('OTHER', 'Other', '6190')) AS m(code, name, account_code)
  JOIN accounts a ON a.code = m.account_code
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories c WHERE c.code = m.code);
