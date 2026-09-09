-- supabase/tests/b2b_debts_gate.test.sql
-- Audit b2b-credit 2026-08-31 finding n°2 (P1) — `get_pos_b2b_debts` doit exiger
-- la permission `b2b.debts.view`. La v3 ne testait que `auth.uid() IS NOT NULL`,
-- alors que la fonction rend TOUT le carnet de créances (nom, téléphone, plafond,
-- solde) quand `p_customer_id` est NULL.
--
-- Un test de refus ne vaut rien sans contrôle POSITIF : T2 prouve qu'un acteur
-- porteur de la permission FRANCHIT la gate. Sans lui, une fonction qui refuse
-- tout le monde passerait le test de refus.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(5);

DO $$
DECLARE v_auth UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'b2b.debts.view')
   ORDER BY up.employee_code LIMIT 1;
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'Aucun profil actif porteur de b2b.debts.view';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  PERFORM set_config('breakery.debts_auth', v_auth::text, true);
END $$;

-- T1 : la permission existe et le caissier la détient (arbitrage 2026-09-08 —
-- l'écran Debts du POS reste ouvert à la caisse).
SELECT is(
  (SELECT count(*)::int FROM permissions WHERE code = 'b2b.debts.view') = 1
  AND (SELECT count(*)::int FROM role_permissions
        WHERE permission_code = 'b2b.debts.view' AND is_granted
          AND role_code IN ('CASHIER','waiter','MANAGER','ADMIN','SUPER_ADMIN')) = 5,
  true, 'T1 b2b.debts.view existe et couvre CASHIER, waiter, MANAGER, ADMIN, SUPER_ADMIN');

-- T2 : CONTRÔLE POSITIF — un porteur de la permission franchit la gate.
DO $$ DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM get_pos_b2b_debts_v4(NULL, 730);
  PERFORM set_config('breakery.t2', 'true', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('breakery.t2', 'false', true);
END $$;
SELECT is(current_setting('breakery.t2', true), 'true',
  'T2 un acteur porteur de b2b.debts.view lit les dettes sans exception');

-- T3 : REFUS — la même identité, permission retirée dans la transaction.
UPDATE role_permissions SET is_granted = false
 WHERE permission_code = 'b2b.debts.view'
   AND role_code = (SELECT role_code FROM user_profiles
                     WHERE auth_user_id = current_setting('breakery.debts_auth')::uuid);

DO $$ DECLARE v_n int; v_msg text;
BEGIN
  SELECT count(*) INTO v_n FROM get_pos_b2b_debts_v4(NULL, 730);
  PERFORM set_config('breakery.t3', 'no_raise', true);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  PERFORM set_config('breakery.t3', v_msg, true);
END $$;
SELECT is(current_setting('breakery.t3', true), 'permission_denied: b2b.debts.view',
  'T3 sans b2b.debts.view, la lecture des dettes est refusée');

-- T4 : la v3 non gardée est bien droppée — sinon la porte reste ouverte à côté.
SELECT is(
  (SELECT count(*)::int FROM pg_proc
    WHERE proname = 'get_pos_b2b_debts_v3' AND pronamespace = 'public'::regnamespace),
  0, 'T4 get_pos_b2b_debts_v3 (sans gate) est droppée');

-- T5 : paire REVOKE refaite sur la NOUVELLE signature.
SELECT is(
  has_function_privilege('anon', 'public.get_pos_b2b_debts_v4(uuid, int)', 'EXECUTE')
  OR NOT has_function_privilege('authenticated', 'public.get_pos_b2b_debts_v4(uuid, int)', 'EXECUTE'),
  false, 'T5 anon révoqué, authenticated conservé sur la v4');

SELECT * FROM finish();
ROLLBACK;
