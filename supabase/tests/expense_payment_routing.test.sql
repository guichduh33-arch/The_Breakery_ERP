-- supabase/tests/expense_payment_routing.test.sql
-- Audit expense-governance 2026-08-31, findings n°4 et n°5 (P1).
--
-- n°4 : le compte CRÉDITÉ d'un règlement de dépense suivait toujours `EXPENSE_CASH_OUT`
--       (= 1111 Petty Cash depuis le remap du 2026-07-06), quel que soit le moyen choisi.
--       Un virement vidait donc la petite caisse dans les livres. T1/T2/T3.
-- n°5 : un palier d'approbation pouvait citer un rôle qui ne peut PAS approuver ; la
--       tranche gelait alors sans issue. T4/T5/T6.
--
-- Les paliers de test portent une CATÉGORIE dédiée : les paliers par défaut (category NULL)
-- couvrent 0 → 9 999 999 999, donc tout essai sur la catégorie NULL est refusé pour
-- chevauchement AVANT d'atteindre la validation testée ici — le test mesurerait autre chose.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(6);

DO $$
DECLARE v_auth UUID; v_prof UUID; v_cat UUID; v_free_cat UUID; v_exp UUID; v_res jsonb;
        v_credit_code TEXT; v_msg TEXT;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id,'expenses.pay')
     AND has_permission(up.auth_user_id,'expenses.thresholds.write')
   ORDER BY up.employee_code LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'Aucun profil porteur de expenses.pay + expenses.thresholds.write'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cat FROM expense_categories LIMIT 1;
  SELECT c.id INTO v_free_cat FROM expense_categories c
   WHERE NOT EXISTS (SELECT 1 FROM expense_approval_thresholds t WHERE t.category_id = c.id)
   ORDER BY c.id LIMIT 1;
  IF v_cat IS NULL OR v_free_cat IS NULL THEN RAISE EXCEPTION 'Fixture catégories absente'; END IF;

  -- Dépense à crédit réglée par VIREMENT
  INSERT INTO expenses (expense_number, description, amount, expense_date, category_id,
                        payment_method, status, created_by)
  VALUES ('EXP-TEST-'||substr(gen_random_uuid()::text,1,8), 'pgTAP routing transfer', 100000,
          CURRENT_DATE, v_cat, 'credit', 'approved', v_prof)
  RETURNING id INTO v_exp;
  v_res := pay_expense_v3(v_exp, 'transfer');
  SELECT a.code INTO v_credit_code FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
   WHERE l.journal_entry_id = (v_res->>'payment_je_id')::uuid AND l.credit > 0;
  PERFORM set_config('breakery.transfer_acc', v_credit_code, true);

  -- Même dépense réglée en ESPÈCES — contrôle positif : le chemin historique ne bouge pas.
  INSERT INTO expenses (expense_number, description, amount, expense_date, category_id,
                        payment_method, status, created_by)
  VALUES ('EXP-TEST-'||substr(gen_random_uuid()::text,1,8), 'pgTAP routing cash', 50000,
          CURRENT_DATE, v_cat, 'credit', 'approved', v_prof)
  RETURNING id INTO v_exp;
  v_res := pay_expense_v3(v_exp, 'cash');
  SELECT a.code INTO v_credit_code FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
   WHERE l.journal_entry_id = (v_res->>'payment_je_id')::uuid AND l.credit > 0;
  PERFORM set_config('breakery.cash_acc', v_credit_code, true);

  -- Méthode inconnue : elle doit LEVER, pas retomber en silence sur la petite caisse.
  INSERT INTO expenses (expense_number, description, amount, expense_date, category_id,
                        payment_method, status, created_by)
  VALUES ('EXP-TEST-'||substr(gen_random_uuid()::text,1,8), 'pgTAP routing unknown', 1000,
          CURRENT_DATE, v_cat, 'credit', 'approved', v_prof)
  RETURNING id INTO v_exp;
  BEGIN
    PERFORM pay_expense_v3(v_exp, 'bitcoin');
    PERFORM set_config('breakery.bad', 'no_raise', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('breakery.bad', 'raised', true);
  END;

  -- Palier citant CASHIER seul : refusé (CASHIER n'a pas expenses.approve).
  BEGIN
    PERFORM set_expense_threshold_v3(NULL, v_free_cat, 0, 100000,
      jsonb_build_array(jsonb_build_object('label','Impossible','role_codes',jsonb_build_array('CASHIER'))));
    PERFORM set_config('breakery.cashier_step', 'no_raise', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('breakery.cashier_step', 'raised', true);
  END;

  -- CONTRÔLE POSITIF : le même palier avec MANAGER passe. Sans lui, une fonction qui
  -- refuserait TOUT palier passerait les tests de refus.
  BEGIN
    PERFORM set_expense_threshold_v3(NULL, v_free_cat, 0, 100000,
      jsonb_build_array(jsonb_build_object('label','OK','role_codes',jsonb_build_array('MANAGER'))));
    PERFORM set_config('breakery.manager_step', 'ok', true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    PERFORM set_config('breakery.manager_step', v_msg, true);
  END;

  -- Rôle inexistant : refusé aussi.
  BEGIN
    PERFORM set_expense_threshold_v3(NULL, v_free_cat, 200000, 300000,
      jsonb_build_array(jsonb_build_object('label','Ghost','role_codes',jsonb_build_array('WIZARD'))));
    PERFORM set_config('breakery.ghost', 'no_raise', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('breakery.ghost', 'raised', true);
  END;
END $$;

SELECT is(current_setting('breakery.transfer_acc'), '1112',
  'T1 un règlement par virement crédite 1112 Bank - Operating');
SELECT is(current_setting('breakery.cash_acc'), '1111',
  'T2 un règlement en espèces crédite toujours 1111 Petty Cash');
SELECT is(current_setting('breakery.bad'), 'raised',
  'T3 une méthode inconnue lève, au lieu de vider la petite caisse en silence');
SELECT is(current_setting('breakery.cashier_step'), 'raised',
  'T4 un palier dont le seul rôle est CASHIER est refusé');
SELECT is(current_setting('breakery.manager_step'), 'ok',
  'T5 contrôle positif : le même palier avec MANAGER est accepté');
SELECT is(current_setting('breakery.ghost'), 'raised',
  'T6 un role_code inexistant est refusé');

SELECT * FROM finish();
ROLLBACK;
