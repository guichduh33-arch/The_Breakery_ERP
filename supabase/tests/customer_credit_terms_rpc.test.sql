-- supabase/tests/customer_credit_terms_rpc.test.sql
-- ADR-020 dec. 1 — `update_customer_credit_terms_v1` est le SEUL chemin
-- d'ecriture des champs financiers d'une fiche client.
--
-- Ce que la suite prouve, dans l'ordre que l'ADR enumere : l'ecriture autorisee
-- passe, l'ecriture sans permission est refusee, la ligne `audit_logs` est
-- emise avec son diff, et l'UPDATE direct n'est plus ouvert a `authenticated`
-- (migration 20260803000006). Les trois dernieres assertions gardent les
-- validations d'entree de la RPC.
--
-- La garde d'encours qui CONSOMME ces plafonds vit dans
-- `retail_tab_credit_gate.test.sql` — ici on ne teste que l'ecriture.
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_mgr_auth  UUID;
  v_low_auth  UUID;
  v_c1        UUID;
  v_c2        UUID;
BEGIN
  -- Acteur autorise : le premier profil actif, dote d'un compte auth, qui
  -- detient reellement customers.b2b.update. On selectionne sur la PERMISSION
  -- et pas sur le role_code — un reseedage de la matrice ne doit pas rendre la
  -- suite verte a vide. ORDER BY employee_code : sans ordre, un LIMIT 1 pioche
  -- au hasard parmi les candidats et la suite devient intermittente.
  SELECT up.auth_user_id INTO v_mgr_auth
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'customers.b2b.update')
   ORDER BY up.employee_code LIMIT 1;
  IF v_mgr_auth IS NULL THEN
    RAISE EXCEPTION 'Aucun profil actif porteur de customers.b2b.update';
  END IF;

  -- Acteur non autorise : ni customers.b2b.update ni customers.update (profil
  -- de caisse). Les deux gates de la RPC sont distincts, on veut les deux nus.
  SELECT up.auth_user_id INTO v_low_auth
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND NOT has_permission(up.auth_user_id, 'customers.b2b.update')
     AND NOT has_permission(up.auth_user_id, 'customers.update')
   ORDER BY up.employee_code LIMIT 1;
  IF v_low_auth IS NULL THEN
    RAISE EXCEPTION 'Aucun profil actif depourvu de customers.update et customers.b2b.update';
  END IF;

  INSERT INTO customers (name, customer_type, b2b_credit_limit, b2b_payment_terms_days, retail_credit_limit)
    VALUES ('ADR020 CT C1', 'b2b', 1000000, 14, NULL) RETURNING id INTO v_c1;
  INSERT INTO customers (name, customer_type, deleted_at)
    VALUES ('ADR020 CT C2 (inactive)', 'retail', now()) RETURNING id INTO v_c2;

  PERFORM set_config('adr020ct.mgr', v_mgr_auth::text, true);
  PERFORM set_config('adr020ct.low', v_low_auth::text, true);
  PERFORM set_config('adr020ct.c1',  v_c1::text, true);
  PERFORM set_config('adr020ct.c2',  v_c2::text, true);
END $$;

-- Chaque bloc pose l'identite de la transaction en tete : la RPC lit auth.uid(),
-- et les deux claims sont locales a la transaction (is_local = true).

-- T1: ecriture autorisee -> la colonne bouge et l'enveloppe la reflete.
DO $$ DECLARE v_res JSONB; BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ct.mgr'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ct.mgr'))::text, true);
  v_res := update_customer_credit_terms_v1(
    current_setting('adr020ct.c1')::uuid,
    '{"b2b_credit_limit": 7500000, "b2b_payment_terms_days": 30}'::jsonb);
  INSERT INTO _r VALUES ('t1_envelope',
    (v_res->>'b2b_credit_limit')::numeric = 7500000
    AND (v_res->>'b2b_payment_terms_days')::int = 30);
  INSERT INTO _r VALUES ('t1_row',
    (SELECT b2b_credit_limit FROM customers WHERE id = current_setting('adr020ct.c1')::uuid) = 7500000
    AND (SELECT b2b_payment_terms_days FROM customers WHERE id = current_setting('adr020ct.c1')::uuid) = 30);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_envelope', false);
  INSERT INTO _r VALUES ('t1_row', false);
END $$;

-- T2: la ligne audit_logs porte le diff — `metadata` nomme les champs touches,
-- `payload` transporte l'avant et l'apres. Les deux colonnes sont distinctes
-- (CLAUDE.md) : on les asserte separement.
DO $$ DECLARE v_log RECORD; BEGIN
  SELECT metadata, payload INTO v_log
    FROM audit_logs
   WHERE action = 'customer.update_credit_terms'
     AND entity_type = 'customers'
     AND entity_id = current_setting('adr020ct.c1')::uuid
   ORDER BY created_at DESC LIMIT 1;
  INSERT INTO _r VALUES ('t2_audit',
    v_log.metadata->'fields' ? 'b2b_credit_limit'
    AND (v_log.payload->'before'->>'b2b_credit_limit')::numeric = 1000000
    AND (v_log.payload->'after'->>'b2b_credit_limit')::numeric  = 7500000);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_audit', false);
END $$;

-- T3: le gate B2B est nu — un acteur sans customers.b2b.update est refuse.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ct.low'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ct.low'))::text, true);
  PERFORM update_customer_credit_terms_v1(
    current_setting('adr020ct.c1')::uuid, '{"b2b_credit_limit": 99000000}'::jsonb);
  INSERT INTO _r VALUES ('t3_b2b_denied', false);
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  INSERT INTO _r VALUES ('t3_b2b_denied', SQLERRM LIKE '%customers.b2b.update%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_b2b_denied', false);
END $$;

-- T3 bis: le plafond retail a son propre gate — customers.update, pas le gate B2B.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ct.low'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ct.low'))::text, true);
  PERFORM update_customer_credit_terms_v1(
    current_setting('adr020ct.c1')::uuid, '{"retail_credit_limit": 500000}'::jsonb);
  INSERT INTO _r VALUES ('t3b_retail_denied', false);
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  INSERT INTO _r VALUES ('t3b_retail_denied', SQLERRM LIKE '%customers.update%'
                                          AND SQLERRM NOT LIKE '%b2b%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3b_retail_denied', false);
END $$;

-- T4: l'UPDATE direct n'existe plus pour `authenticated` (migration
-- 20260803000006). On interroge le GRANT lui-meme : dans cette enveloppe la
-- session est proprietaire, un UPDATE reel ne prouverait rien du GRANT.
--
-- 2026-08-03 — cette assertion verifiait aussi que `name` RESTAIT accordee, pour
-- prouver que le grant colonne n'avait pas ete rase en bloc mais seulement
-- ampute des champs financiers. C'etait vrai de la decision 1 ; la decision 2
-- (migration 20260803000008) a depuis ferme TOUTE ecriture directe sur
-- `customers` au profit de update_customer_v1. La clause est donc retiree — la
-- fermeture complete est desormais assertee par adr020_ecriture_fiche_client.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t4_direct_update_revoked',
    NOT has_column_privilege('authenticated', 'public.customers', 'b2b_credit_limit',       'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customers', 'b2b_payment_terms_days', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customers', 'b2b_tax_id',         'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customers', 'customer_type',      'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customers', 'retail_credit_limit','UPDATE'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_direct_update_revoked', false);
END $$;

-- T5: un champ hors perimetre est rejete — la RPC n'est pas un UPDATE generique.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ct.mgr'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ct.mgr'))::text, true);
  PERFORM update_customer_credit_terms_v1(
    current_setting('adr020ct.c1')::uuid, '{"loyalty_points": 99999}'::jsonb);
  INSERT INTO _r VALUES ('t5_invalid_field', false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  INSERT INTO _r VALUES ('t5_invalid_field', SQLERRM LIKE 'invalid_field%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_invalid_field', false);
END $$;

-- T6: un plafond negatif est refuse.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ct.mgr'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ct.mgr'))::text, true);
  PERFORM update_customer_credit_terms_v1(
    current_setting('adr020ct.c1')::uuid, '{"b2b_credit_limit": -1}'::jsonb);
  INSERT INTO _r VALUES ('t6_negative', false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  INSERT INTO _r VALUES ('t6_negative', SQLERRM LIKE 'invalid_credit_limit%');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_negative', false);
END $$;

-- T7: une fiche desactivee ne s'ecrit pas.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ct.mgr'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ct.mgr'))::text, true);
  PERFORM update_customer_credit_terms_v1(
    current_setting('adr020ct.c2')::uuid, '{"b2b_credit_limit": 100000}'::jsonb);
  INSERT INTO _r VALUES ('t7_inactive', false);
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO _r VALUES ('t7_inactive', SQLERRM = 'customer_not_found_or_inactive');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_inactive', false);
END $$;

SELECT plan(9);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_envelope'), 'T1a: ecriture autorisee — l enveloppe renvoie les valeurs ecrites');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_row'),      'T1b: ecriture autorisee — la ligne customers porte les nouvelles valeurs');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_audit'),    'T2: audit_logs emis — metadata nomme le champ, payload porte le diff 1000000 -> 7500000');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_b2b_denied'),   'T3: sans customers.b2b.update -> P0003');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3b_retail_denied'),'T3bis: le plafond retail exige customers.update, gate distinct du B2B');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_direct_update_revoked'), 'T4: UPDATE direct des 5 champs financiers revoque a authenticated');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_invalid_field'), 'T5: champ hors perimetre -> P0001 invalid_field');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_negative'),      'T6: plafond negatif -> P0001 invalid_credit_limit');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_inactive'),      'T7: fiche desactivee -> P0002 customer_not_found_or_inactive');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();

ROLLBACK;
