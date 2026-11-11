-- S3-15, suite — la catégorie « Office » vise son compte, même déjà utilisée.
--
-- Arbitrage de Mamat du 2026-11-11 : les dépenses FUTURES de « Office » vont
-- sur `6123` ; les dépenses passées restent sur `6190`, aucune écriture n'est
-- réécrite. Relevé en production le même jour : 2 dépenses, 896 926,14 IDR.
--
-- La garde `expense_category_account_in_use` interdit ce changement à l'écran,
-- et elle a raison de le faire en service courant. Elle est levée ici une
-- seule fois, pour cette seule catégorie, et la levée est tracée. Le contrôle
-- de validité du compte (classe 6, actif, postable) est refait à la main.
-- Sans effet là où « Office » vise déjà `6123`.
DO $office$
DECLARE
  v_category RECORD;
  v_account  UUID;
BEGIN
  SELECT id INTO v_account FROM accounts
   WHERE code = '6123' AND account_class = 6 AND is_active AND is_postable AND deleted_at IS NULL;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'office_expense_account_6123_missing_or_invalid';
  END IF;

  SELECT c.id, c.account_id, a.code AS old_code INTO v_category
    FROM expense_categories c JOIN accounts a ON a.id = c.account_id
   WHERE c.code = 'OFFICE';
  IF NOT FOUND OR v_category.account_id = v_account THEN
    RETURN;
  END IF;

  ALTER TABLE expense_categories DISABLE TRIGGER guard_expense_category_definition;
  UPDATE expense_categories SET account_id = v_account WHERE id = v_category.id;
  ALTER TABLE expense_categories ENABLE TRIGGER guard_expense_category_definition;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES ('expense.category.account_reassigned', 'expense_categories', v_category.id,
          jsonb_build_object(
            'category_code', 'OFFICE',
            'old_account',   v_category.old_code,
            'new_account',   '6123',
            'used_by_expenses', (SELECT count(*) FROM expenses e WHERE e.category_id = v_category.id),
            'basis', 'owner decision 2026-11-11: future expenses only, past entries untouched',
            'source', 'migration 20261111000014'),
          NULL);
END $office$;
