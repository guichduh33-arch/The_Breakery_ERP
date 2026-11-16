-- Repas et boissons du personnel : un compte de charge et sa catégorie.
--
-- Décision de Mamat du 2026-11-16 : les repas et boissons offerts au personnel
-- pendant le service — directeur salarié de la PT compris — sont une charge de
-- personnel. Ils ont leur propre compte, distinct de 6111 (salaires) et de 6190
-- (autres charges), pour rester lisibles au compte de résultat.
--
-- Même forme que les comptes 611x/612x posés par 20261111000013. Rejouable :
-- sans effet là où le compte et la catégorie existent déjà.

INSERT INTO accounts (code, name, account_class, account_type, balance_type,
                      is_postable, is_system, is_active, cash_flow_section) VALUES
  ('6124', 'Staff Meals & Welfare', 6, 'expense', 'debit', true, true, true, 'operating')
ON CONFLICT (code) DO NOTHING;

INSERT INTO expense_categories (code, name, account_id, is_active, description)
SELECT 'STAFF_MEALS', 'Staff Meals', a.id, true,
       'Meals and drinks provided to staff during working hours'
  FROM accounts a
 WHERE a.code = '6124'
   AND NOT EXISTS (SELECT 1 FROM expense_categories c WHERE c.code = 'STAFF_MEALS');
