-- supabase/tests/adr020_lot2e_gates_audit.test.sql
-- ADR-020 décision 6 (lot e) + décision 5 (résiduel) — traçabilité et lecture.
--
-- Ce que ces assertions ferment :
--   - l'ajustement manuel de points laissait une ligne de ledger mais AUCUNE
--     ligne d'audit, alors que les points se convertissent en avoir monétaire ;
--   - l'export de masse du fichier clients (PII + plafonds B2B) était un
--     SELECT client-side sans trace possible ;
--   - loyalty_transactions et customer_product_prices étaient lisibles par
--     tout authentifié (is_authenticated()), là où customers exige
--     customers.read ;
--   - le modèle customer_birthday promettait un crédit de points inexistant,
--     et notify_birthday_customers_v2 restait exécutable par authenticated.
--
-- Sélection des profils par PERMISSIONS, jamais par role_code (un reseedage ne
-- doit pas rendre la suite verte à vide). Run via MCP execute_sql — enveloppe
-- BEGIN..ROLLBACK portée par ce fichier.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_adj  UUID;  -- loyalty.adjust + customers.read
  v_lect UUID;  -- customers.read SANS loyalty.adjust
  v_nul  UUID;  -- ni customers.read ni loyalty.adjust
  v_cust UUID;
  v_prod UUID;
BEGIN
  SELECT up.auth_user_id INTO v_adj FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'loyalty.adjust')
     AND has_permission(up.auth_user_id, 'customers.read')
   ORDER BY up.employee_code LIMIT 1;

  SELECT up.auth_user_id INTO v_lect FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'customers.read')
     AND NOT has_permission(up.auth_user_id, 'loyalty.adjust')
   ORDER BY up.employee_code LIMIT 1;

  SELECT up.auth_user_id INTO v_nul FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND NOT has_permission(up.auth_user_id, 'customers.read')
     AND NOT has_permission(up.auth_user_id, 'loyalty.adjust')
   ORDER BY up.employee_code LIMIT 1;

  IF v_adj IS NULL OR v_lect IS NULL OR v_nul IS NULL THEN
    RAISE EXCEPTION 'Profils de test manquants (adj=%, lecteur=%, sans droit=%)',
      v_adj IS NOT NULL, v_lect IS NOT NULL, v_nul IS NOT NULL;
  END IF;

  INSERT INTO customers (name, customer_type, category_id)
    VALUES ('ADR020 L2E Cible', 'retail',
            (SELECT cc.id FROM customer_categories cc
              WHERE cc.is_default = true AND cc.deleted_at IS NULL LIMIT 1))
    RETURNING id INTO v_cust;

  -- Un prix négocié à voir/ne pas voir pour les tests RLS (insert en postgres,
  -- la table n'a aucun chemin d'écriture authenticated).
  SELECT p.id INTO v_prod FROM products p WHERE p.deleted_at IS NULL LIMIT 1;
  INSERT INTO customer_product_prices (customer_id, product_id, price)
    VALUES (v_cust, v_prod, 12345);

  PERFORM set_config('l2e.adj',  v_adj::text,  true);
  PERFORM set_config('l2e.lect', v_lect::text, true);
  PERFORM set_config('l2e.nul',  v_nul::text,  true);
  PERFORM set_config('l2e.cust', v_cust::text, true);
END $$;

-- T1 — ajustement autorisé : ledger + ligne d'audit, actor = id de PROFIL
-- (jamais auth.uid()), metadata/payload complets.
DO $$ DECLARE v_row RECORD; v_audit RECORD; v_profile UUID; BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.adj'), 'role', 'authenticated')::text, true);
  SELECT * INTO v_row FROM adjust_loyalty_points_v2(
    current_setting('l2e.cust')::uuid, 100, 'ADR020 lot e — test T1');
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = current_setting('l2e.adj')::uuid AND deleted_at IS NULL;
  SELECT * INTO v_audit FROM audit_logs
   WHERE action = 'loyalty.adjust' AND entity_id = current_setting('l2e.cust')::uuid
   ORDER BY id DESC LIMIT 1;
  INSERT INTO _r VALUES ('t01_adjust_audite',
    v_row.txn_id IS NOT NULL AND v_row.new_balance = 100
    AND v_audit.actor_id = v_profile
    AND (v_audit.payload->>'delta')::int = 100
    AND (v_audit.payload->>'balance_before')::int = 0
    AND (v_audit.payload->>'balance_after')::int = 100
    AND (v_audit.metadata->>'loyalty_txn_id')::uuid = v_row.txn_id
    AND (SELECT count(*) FROM loyalty_transactions lt
          WHERE lt.id = v_row.txn_id AND lt.transaction_type = 'adjust') = 1);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('t01_adjust_audite', false); END $$;

-- T2 — customers.read sans loyalty.adjust : refusé (garde négative).
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.lect'), 'role', 'authenticated')::text, true);
  PERFORM adjust_loyalty_points_v2(current_setting('l2e.cust')::uuid, 10, 'ADR020 lot e — test T2');
  INSERT INTO _r VALUES ('t02_adjust_refuse_lecteur', false);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t02_adjust_refuse_lecteur', SQLERRM = 'forbidden');
END $$;

-- T3 — sans aucun droit : refusé.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.nul'), 'role', 'authenticated')::text, true);
  PERFORM adjust_loyalty_points_v2(current_setting('l2e.cust')::uuid, 10, 'ADR020 lot e — test T3');
  INSERT INTO _r VALUES ('t03_adjust_refuse_sans_droit', false);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t03_adjust_refuse_sans_droit', SQLERRM = 'forbidden');
END $$;

-- T4 — versioning monotone : l'ancienne signature non versionnée est droppée.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t04_ancienne_version_absente',
    to_regprocedure('public.adjust_loyalty_points(uuid,integer,text)') IS NULL);
END $$;

-- T5 — RLS loyalty_transactions : sans customers.read, aucune ligne visible.
DO $$ DECLARE n INT; BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.nul'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM loyalty_transactions;
  RESET ROLE;
  INSERT INTO _r VALUES ('t05_rls_loyalty_sans_droit', n = 0);
EXCEPTION WHEN OTHERS THEN
  RESET ROLE; INSERT INTO _r VALUES ('t05_rls_loyalty_sans_droit', false);
END $$;

-- T6 — RLS loyalty_transactions : customers.read voit la ligne du T1.
DO $$ DECLARE n INT; BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.lect'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM loyalty_transactions
   WHERE customer_id = current_setting('l2e.cust')::uuid;
  RESET ROLE;
  INSERT INTO _r VALUES ('t06_rls_loyalty_lecteur', n = 1);
EXCEPTION WHEN OTHERS THEN
  RESET ROLE; INSERT INTO _r VALUES ('t06_rls_loyalty_lecteur', false);
END $$;

-- T7 — RLS customer_product_prices : sans customers.read, rien.
DO $$ DECLARE n INT; BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.nul'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM customer_product_prices;
  RESET ROLE;
  INSERT INTO _r VALUES ('t07_rls_prix_sans_droit', n = 0);
EXCEPTION WHEN OTHERS THEN
  RESET ROLE; INSERT INTO _r VALUES ('t07_rls_prix_sans_droit', false);
END $$;

-- T8 — RLS customer_product_prices : customers.read voit le prix du décor.
DO $$ DECLARE n INT; BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.lect'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM customer_product_prices
   WHERE customer_id = current_setting('l2e.cust')::uuid;
  RESET ROLE;
  INSERT INTO _r VALUES ('t08_rls_prix_lecteur', n = 1);
EXCEPTION WHEN OTHERS THEN
  RESET ROLE; INSERT INTO _r VALUES ('t08_rls_prix_lecteur', false);
END $$;

-- T9 — export autorisé : lignes = fiches actives, ligne d'audit avec row_count
-- et actor = id de PROFIL du lecteur.
DO $$ DECLARE n INT; v_actifs INT; v_audit RECORD; v_profile UUID; BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.lect'), 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM export_customers_v1();
  SELECT count(*) INTO v_actifs FROM customers WHERE deleted_at IS NULL;
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = current_setting('l2e.lect')::uuid AND deleted_at IS NULL;
  SELECT * INTO v_audit FROM audit_logs
   WHERE action = 'customer.export' ORDER BY id DESC LIMIT 1;
  INSERT INTO _r VALUES ('t09_export_audite',
    n = v_actifs AND n > 0
    AND v_audit.actor_id = v_profile
    AND (v_audit.metadata->>'row_count')::int = n);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('t09_export_audite', false); END $$;

-- T10 — export sans customers.read : refusé (garde négative).
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('l2e.nul'), 'role', 'authenticated')::text, true);
  PERFORM count(*) FROM export_customers_v1();
  INSERT INTO _r VALUES ('t10_export_refuse', false);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t10_export_refuse', SQLERRM = 'forbidden');
END $$;

-- T11 — ACL : anon ne peut exécuter ni l'ajustement ni l'export ; authenticated
-- et anon ne peuvent plus exécuter la fonction d'anniversaire (déc. 5).
DO $$ BEGIN
  INSERT INTO _r VALUES ('t11_acl',
    NOT has_function_privilege('anon', 'public.adjust_loyalty_points_v2(uuid,integer,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.export_customers_v1()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.notify_birthday_customers_v2()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.notify_birthday_customers_v2()', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notify_birthday_customers_v2()', 'EXECUTE'));
END $$;

-- T12 — le modèle d'anniversaire ne promet plus aucun crédit (déc. 5) : plus
-- de bonus/credited, le prénom reste, l'envoi reste actif.
DO $$ DECLARE t RECORD; BEGIN
  SELECT * INTO t FROM notification_templates WHERE code = 'customer_birthday';
  INSERT INTO _r VALUES ('t12_template_sans_promesse',
    t.is_active
    AND t.body_template NOT ILIKE '%credit%'
    AND t.body_template NOT ILIKE '%bonus%'
    AND t.body_template NOT ILIKE '%point%'
    AND position('{{customer_name}}' IN t.body_template) > 0
    AND t.variables = '["customer_name"]'::jsonb);
END $$;

SELECT plan(12);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t01_adjust_audite'),           'T1: ajustement autorise -> ledger + ligne audit_logs (actor = id de profil, diff complet)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t02_adjust_refuse_lecteur'),   'T2: customers.read sans loyalty.adjust -> forbidden');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t03_adjust_refuse_sans_droit'),'T3: sans aucun droit -> forbidden');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t04_ancienne_version_absente'),'T4: adjust_loyalty_points (non versionnee) droppee, seule la v2 vit');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t05_rls_loyalty_sans_droit'),  'T5: RLS loyalty_transactions -> 0 ligne sans customers.read');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t06_rls_loyalty_lecteur'),     'T6: RLS loyalty_transactions -> customers.read voit le ledger');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t07_rls_prix_sans_droit'),     'T7: RLS customer_product_prices -> 0 ligne sans customers.read');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t08_rls_prix_lecteur'),        'T8: RLS customer_product_prices -> customers.read voit le prix negocie');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t09_export_audite'),           'T9: export autorise -> lignes = fiches actives + audit_logs (row_count, actor profil)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t10_export_refuse'),           'T10: export sans customers.read -> forbidden');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t11_acl'),                     'T11: ACL — anon exclu partout, notify_birthday_v2 ferme a authenticated, service_role conserve');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t12_template_sans_promesse'),  'T12: le modele anniversaire ne promet plus aucun credit de points');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();

ROLLBACK;
