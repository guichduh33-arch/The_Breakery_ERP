-- supabase/tests/adr020_ecriture_fiche_client.test.sql
-- ADR-020 décisions 2 et 3 — toute écriture de fiche client passe par une RPC
-- gatée et auditée, et l'écriture directe sur les catégories est fermée.
--
-- Le défaut que ces assertions ferment : `create_customer_v2` était SECURITY
-- DEFINER SANS AUCUN GATE et acceptait un type de client en paramètre. Vérifié
-- en base le 2026-08-03, le rôle CASHIER ne détient aucune permission
-- `customers.*` — il pouvait pourtant créer un compte B2B. C3 est l'assertion
-- qui compte : la caisse crée du retail, jamais du B2B.
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_admin  UUID;   -- customers.create + update + read
  v_caisse UUID;   -- customers.pos.create SEULEMENT
  v_nul    UUID;   -- aucun droit de creation
  v_cust   UUID;
BEGIN
  -- Selection sur les PERMISSIONS, pas sur le role_code : un reseedage de la
  -- matrice ne doit pas rendre la suite verte a vide. ORDER BY employee_code
  -- et is_active : sans eux, un LIMIT 1 pioche au hasard (lecon du 2026-08-03).
  SELECT up.auth_user_id INTO v_admin FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'customers.create')
     AND has_permission(up.auth_user_id, 'customers.update')
     AND has_permission(up.auth_user_id, 'customers.read')
   ORDER BY up.employee_code LIMIT 1;

  SELECT up.auth_user_id INTO v_caisse FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'customers.pos.create')
     AND NOT has_permission(up.auth_user_id, 'customers.create')
   ORDER BY up.employee_code LIMIT 1;

  SELECT up.auth_user_id INTO v_nul FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND NOT has_permission(up.auth_user_id, 'customers.create')
     AND NOT has_permission(up.auth_user_id, 'customers.pos.create')
   ORDER BY up.employee_code LIMIT 1;

  IF v_admin IS NULL OR v_caisse IS NULL OR v_nul IS NULL THEN
    RAISE EXCEPTION 'Profils de test manquants (admin=%, caisse=%, sans droit=%)',
      v_admin IS NOT NULL, v_caisse IS NOT NULL, v_nul IS NOT NULL;
  END IF;

  -- La fiche cible porte une categorie : sans elle, ce decor ferait tomber C10,
  -- qui compte les fiches actives sans categorie.
  INSERT INTO customers (name, customer_type, category_id)
    VALUES ('ADR020 EC Cible', 'retail',
            (SELECT cc.id FROM customer_categories cc
              WHERE cc.is_default = true AND cc.deleted_at IS NULL LIMIT 1))
    RETURNING id INTO v_cust;

  PERFORM set_config('adr020ec.admin',  v_admin::text,  true);
  PERFORM set_config('adr020ec.caisse', v_caisse::text, true);
  PERFORM set_config('adr020ec.nul',    v_nul::text,    true);
  PERFORM set_config('adr020ec.cust',   v_cust::text,   true);
END $$;

-- C1: création autorisée -> fiche créée, catégorie par défaut affectée serveur,
--     ligne d'audit émise.
DO $$ DECLARE v_row RECORD; v_defaut UUID; v_audit INT; BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ec.admin'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ec.admin'))::text, true);
  SELECT cc.id INTO v_defaut FROM customer_categories cc
   WHERE cc.is_default = true AND cc.deleted_at IS NULL LIMIT 1;
  SELECT * INTO v_row FROM create_customer_v3('ADR020 EC Neuf', '0800000001');
  SELECT count(*) INTO v_audit FROM audit_logs
   WHERE action = 'customer.create' AND entity_id = v_row.id;
  INSERT INTO _r VALUES ('c1_creation',
    v_row.id IS NOT NULL AND v_row.name = 'ADR020 EC Neuf'
    AND v_row.category_id IS NOT DISTINCT FROM v_defaut
    AND v_audit = 1);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('c1_creation', false); END $$;

-- C2: aucun droit de création -> P0003. v2 n'avait aucun gate : n'importe quel
--     authentifié créait des fiches.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ec.nul'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ec.nul'))::text, true);
  PERFORM create_customer_v3('ADR020 EC Refuse', '0800000002');
  INSERT INTO _r VALUES ('c2_sans_droit', false);
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  INSERT INTO _r VALUES ('c2_sans_droit', SQLERRM LIKE '%customers.create%');
WHEN OTHERS THEN INSERT INTO _r VALUES ('c2_sans_droit', false); END $$;

-- C3: LE point de l'ADR — la caisse ne crée PAS de compte B2B.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ec.caisse'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ec.caisse'))::text, true);
  PERFORM create_customer_v3('ADR020 EC B2B', '0800000003', NULL, 'b2b'::customer_type);
  INSERT INTO _r VALUES ('c3_caisse_pas_b2b', false);
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  INSERT INTO _r VALUES ('c3_caisse_pas_b2b', SQLERRM LIKE '%customers.create%');
WHEN OTHERS THEN INSERT INTO _r VALUES ('c3_caisse_pas_b2b', false); END $$;

-- C4: ... mais elle crée bien du retail, sinon la création express est morte.
DO $$ DECLARE v_row RECORD; BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ec.caisse'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ec.caisse'))::text, true);
  SELECT * INTO v_row FROM create_customer_v3('ADR020 EC Express', '0800000004');
  INSERT INTO _r VALUES ('c4_caisse_retail',
    v_row.id IS NOT NULL AND v_row.customer_type = 'retail');
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('c4_caisse_retail', false); END $$;

-- C5: modification autorisée -> valeurs écrites et diff au journal d'audit.
DO $$ DECLARE v_res JSONB; v_log RECORD; BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ec.admin'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ec.admin'))::text, true);
  v_res := update_customer_v1(current_setting('adr020ec.cust')::uuid,
             '{"name": "ADR020 EC Renomme", "email": "ec@breakery.test"}'::jsonb);
  SELECT metadata, payload INTO v_log FROM audit_logs
   WHERE action = 'customer.update' AND entity_id = current_setting('adr020ec.cust')::uuid
   ORDER BY created_at DESC LIMIT 1;
  INSERT INTO _r VALUES ('c5_modification',
    v_res->>'name' = 'ADR020 EC Renomme'
    AND (SELECT name FROM customers WHERE id = current_setting('adr020ec.cust')::uuid) = 'ADR020 EC Renomme'
    AND v_log.metadata->'fields' ? 'name'
    AND v_log.payload->'before'->>'name' = 'ADR020 EC Cible'
    AND v_log.payload->'after'->>'name'  = 'ADR020 EC Renomme');
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('c5_modification', false); END $$;

-- C6: modification sans customers.update -> P0003.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ec.caisse'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ec.caisse'))::text, true);
  PERFORM update_customer_v1(current_setting('adr020ec.cust')::uuid, '{"name": "pirate"}'::jsonb);
  INSERT INTO _r VALUES ('c6_update_refuse', false);
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  INSERT INTO _r VALUES ('c6_update_refuse', SQLERRM LIKE '%customers.update%');
WHEN OTHERS THEN INSERT INTO _r VALUES ('c6_update_refuse', false); END $$;

-- C7: un champ FINANCIER est refusé ici — il relève du gate customers.b2b.update
--     de update_customer_credit_terms_v1. Refuser vaut mieux qu'ignorer : un
--     patch partiellement applique serait pire.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('adr020ec.admin'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('adr020ec.admin'))::text, true);
  PERFORM update_customer_v1(current_setting('adr020ec.cust')::uuid,
            '{"b2b_credit_limit": 99000000}'::jsonb);
  INSERT INTO _r VALUES ('c7_champ_financier', false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  INSERT INTO _r VALUES ('c7_champ_financier', SQLERRM LIKE 'financial_field_use_credit_terms_rpc%');
WHEN OTHERS THEN INSERT INTO _r VALUES ('c7_champ_financier', false); END $$;

-- C8: l'écriture directe sur `customers` est fermée à `authenticated`, et la
--     policy permissive a disparu. On interroge les GRANT eux-mêmes : dans cette
--     enveloppe la session est propriétaire, un INSERT réel ne prouverait rien.
DO $$ BEGIN
  INSERT INTO _r VALUES ('c8_customers_ferme',
    NOT has_column_privilege('authenticated', 'public.customers', 'name',          'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.customers', 'customer_type', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.customers', 'name',      'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customers', 'category_id','UPDATE')
    AND NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname = 'public' AND tablename = 'customers'
                       AND policyname = 'auth_insert_retail'));
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('c8_customers_ferme', false); END $$;

-- C9: décision 3 — les leviers de prix des catégories ne sont plus écrivables
--     en direct. Les trois RPC CRUD gatées restent le seul chemin.
DO $$ BEGIN
  INSERT INTO _r VALUES ('c9_categories_ferme',
    NOT has_column_privilege('authenticated', 'public.customer_categories', 'discount_percentage', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_categories', 'points_multiplier', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_categories', 'price_modifier_type', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.customer_categories', 'is_default', 'INSERT')
    AND has_table_privilege('authenticated', 'public.customer_categories', 'SELECT'));
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('c9_categories_ferme', false); END $$;

-- C10: plus aucune fiche active sans catégorie (rattachement au défaut).
DO $$ BEGIN
  INSERT INTO _r VALUES ('c10_sans_categorie',
    (SELECT count(*) FROM customers WHERE category_id IS NULL AND deleted_at IS NULL) = 0);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('c10_sans_categorie', false); END $$;

SELECT plan(10);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c1_creation'),       'C1: creation autorisee -> fiche + categorie par defaut + ligne audit_logs');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c2_sans_droit'),     'C2: sans droit de creation -> P0003 (v2 n avait aucun gate)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c3_caisse_pas_b2b'), 'C3: la caisse ne peut PAS creer de compte B2B -> P0003');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c4_caisse_retail'),  'C4: la caisse cree bien du retail (creation express preservee)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c5_modification'),   'C5: modification autorisee -> valeurs ecrites + diff avant/apres au journal');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c6_update_refuse'),  'C6: modification sans customers.update -> P0003');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c7_champ_financier'),'C7: champ financier refuse ici (releve de update_customer_credit_terms_v1)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c8_customers_ferme'),'C8: ecriture directe sur customers fermee + policy auth_insert_retail supprimee');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c9_categories_ferme'),'C9: leviers de prix des categories non ecrivables en direct, lecture conservee');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='c10_sans_categorie'),'C10: plus aucune fiche active sans categorie');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();

ROLLBACK;
