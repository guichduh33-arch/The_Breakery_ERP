-- supabase/tests/actor_profile_transverse.test.sql
-- Lot « actor_id transverse » (audit lot 1 du 2026-08-31, security-fraud-guard finding 3,
-- migrations 20260901000013 → 20260901000016) : 32 RPC écrivaient auth.uid() dans
-- audit_logs.actor_id (FK user_profiles.id) — et cinq d'entre elles dans d'autres colonnes
-- FK vers user_profiles (expenses.*_by, purchase_orders.created_by/received_by,
-- orders.served_by, journal_entries.created_by). Tout compte créé par le back-office
-- (id <> auth_user_id) faisait échouer ces gestes en 23503.
--
-- Les suites existantes ne voyaient pas le bug : leurs fixtures utilisateurs sont des
-- comptes seed (id = auth_user_id). Ce fichier construit UN profil au format
-- create_user_v1 réel (id <> auth_user_id, SUPER_ADMIN) et traverse un échantillon de
-- chaque volet du lot (catalogue, imports, commandes, coffre), plus le helper lui-même,
-- le versioning et le cron.
--
-- AVANT les migrations : les appels échouent en 42883 (les _vN+1 n'existent pas) ; sur le
-- corps live des _vN, la même sonde rendait 23503 (relevé du 2026-09-06 :
-- create_category_v1, record_cash_wallet_movement_v1, import_suppliers_v1).
-- APRÈS : chaque appel vit, et l'acteur écrit est user_profiles.id, jamais auth_user_id.
--
-- Couverture (T1-T27) :
--   T1  _current_profile_id() = profil sous le JWT du compte id <> auth_user_id
--   T2  helper : anon et authenticated n'ont pas EXECUTE (helper interne)
--   T3  create_category_v2      → audit category.create, actor = profil (RED : 23503)
--   T4  create_product_v3       → audit product.create, actor = profil
--   T5  update_product_v3       → audit product.update, actor = profil
--   T6  set_product_is_test_v2  → audit product.set_test_flag, actor = profil
--   T7  upsert_section_v2       → audit section.create, actor = profil
--   T8  delete_section_v2       → audit section.delete, actor = profil
--   T9  add_order_item_v6       → audit order.item.add, actor = profil
--   T10 remove_order_item_v4    → audit order.item.remove, actor = profil
--   T11 discard_held_order_v2   → audit order.held_discarded, actor = profil
--   T12 import_suppliers_v2     → audit suppliers.imported, actor = profil
--   T13 import_sales_v2         → audit sales.imported, actor = profil
--   T14 import_sales_v2         → orders.served_by = profil (colonne FK, pas seulement la trace)
--   T15 import_expenses_v2      → audit expenses.imported, actor = profil
--   T16 import_expenses_v2      → expenses.created_by/submitted_by/approved_by/paid_by = profil
--   T17 record_cash_wallet_movement_v2 → audit cash.wallet_movement, actor = profil
--   T18 record_cash_wallet_movement_v2 → journal_entries.created_by = profil (chemin d'argent)
--   T19 convert_product_to_parent_v2 → audit products.variant.parent_created, actor = profil
--   T20 aucune ligne d'audit de ce fixture ne porte un actor NULL
--   T21 les 32 anciennes versions n'existent plus (versioning monotone)
--   T22 les 32 nouvelles versions existent
--   T23 anon n'a EXECUTE sur aucune des 32 nouvelles versions
--   T24 cron recompute-recipe-costs-daily appelle recompute_all_recipe_costs_v3
--   T25 sans contexte auth (cron), _current_profile_id() rend NULL et ne lève pas
--   T26 sans contexte auth, recompute_recipe_cost_v3 vit (chemin cron inchangé)
--   T27 import_purchases_v2     → purchase_orders.created_by / received_by = profil
--
-- Run via MCP execute_sql, wrappé BEGIN ... ROLLBACK (aucune trace ne persiste).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(27);

-- ============================================================================
-- Fixture : un profil create_user_v1-style (id <> auth_user_id), SUPER_ADMIN, puis un
-- passage par chaque RPC échantillonnée. Les identifiants sortent par set_config.
-- ============================================================================
DO $fixture$
DECLARE
  v_auth  UUID := 'a9060000-0000-0000-0000-0000000000a1';
  v_prof  UUID := 'b9060000-0000-0000-0000-0000000000b1';  -- volontairement <> v_auth
  v_cat   JSONB;
  v_prod  JSONB;
  v_sec   JSONB;
  v_sess  UUID;
  v_order UUID;
  v_order2 UUID;
  v_add   JSONB;
  v_je    UUID;
  v_rep   JSONB;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_auth);
  INSERT INTO user_profiles (id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash)
    VALUES (v_prof, v_auth, 'SUPER_ADMIN', 'Actor transverse', 'ACTOR0906', TRUE, crypt('123456', gen_salt('bf')));
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, TRUE);

  -- Catalogue.
  v_cat  := create_category_v2(jsonb_build_object('name', 'Actor category 0906'));
  v_prod := create_product_v3(jsonb_build_object(
              'name', 'Actor product 0906', 'sku', 'ACTOR0906-P1',
              'category_id', v_cat->>'id', 'retail_price', 10000, 'unit', 'pcs'));
  PERFORM update_product_v3((v_prod->'product'->>'id')::uuid, jsonb_build_object('name', 'Actor product 0906 renamed'));
  PERFORM set_product_is_test_v2((v_prod->'product'->>'id')::uuid, TRUE);
  v_sec := upsert_section_v2(jsonb_build_object('code', 'ACT0906', 'name', 'Actor section', 'kind', 'warehouse'));
  PERFORM delete_section_v2((v_sec->>'id')::uuid);

  -- Commande ouverte éditée depuis le back-office, puis abandonnée depuis la caisse
  -- (une commande created_via = 'pos' exige une session : orders_session_id_required_for_pos).
  INSERT INTO pos_sessions (opened_by, opening_cash) VALUES (v_prof, 100000) RETURNING id INTO v_sess;
  INSERT INTO orders (order_number, session_id, order_type, status, subtotal, tax_amount, total, served_by, created_via)
    VALUES ('T-ACT0906-' || gen_random_uuid()::text, v_sess, 'dine_in', 'draft', 0, 0, 0, v_prof, 'pos')
    RETURNING id INTO v_order;
  v_add := add_order_item_v6(v_order, (v_prod->'product'->>'id')::uuid, 1, '[]'::jsonb, gen_random_uuid());
  PERFORM remove_order_item_v4((v_add->>'order_item_id')::uuid, gen_random_uuid());
  -- L'abandon porte sur une SECONDE commande : les clés order_edit_idempotency_keys
  -- posées par add/remove référencent la première sans ON DELETE CASCADE, et
  -- discard_held_order la supprimerait en 23503 (comportement préexistant, hors lot).
  INSERT INTO orders (order_number, session_id, order_type, status, subtotal, tax_amount, total, served_by, created_via)
    VALUES ('T-ACT0906-' || gen_random_uuid()::text, v_sess, 'dine_in', 'draft', 0, 0, 0, v_prof, 'pos')
    RETURNING id INTO v_order2;
  PERFORM discard_held_order_v2(v_order2, 'actor transverse fixture cleanup');

  -- Imports (commit, pas dry-run).
  v_rep := import_suppliers_v2('[{"code":"SUPACT0906","name":"Actor supplier"}]'::jsonb, FALSE, gen_random_uuid());
  IF NOT (v_rep->>'valid')::boolean THEN RAISE EXCEPTION 'fixture: import_suppliers_v2 invalid %', v_rep; END IF;
  v_rep := import_sales_v2(
    '[{"sale_reference":"ACT0906-S1","sale_date":"2026-01-15","product_sku":"ACTOR0906-P1","quantity":1,"unit_price":10000}]'::jsonb,
    FALSE, gen_random_uuid());
  IF NOT (v_rep->>'valid')::boolean THEN RAISE EXCEPTION 'fixture: import_sales_v2 invalid %', v_rep; END IF;
  v_rep := import_expenses_v2(
    jsonb_build_array(jsonb_build_object(
      'expense_date', '2026-01-15',
      'category', (SELECT code FROM expense_categories WHERE is_active ORDER BY code LIMIT 1),
      'description', 'Actor expense 0906', 'amount', 5000)),
    FALSE, gen_random_uuid());
  IF NOT (v_rep->>'valid')::boolean THEN RAISE EXCEPTION 'fixture: import_expenses_v2 invalid %', v_rep; END IF;

  v_rep := import_purchases_v2(
    '[{"po_reference":"ACT0906-PO1","supplier_code":"SUPACT0906","order_date":"2026-01-15","product_sku":"ACTOR0906-P1","quantity":2,"unit_cost":4000,"unit":"pcs"}]'::jsonb,
    FALSE, gen_random_uuid());
  IF NOT (v_rep->>'valid')::boolean THEN RAISE EXCEPTION 'fixture: import_purchases_v2 invalid %', v_rep; END IF;

  -- Coffre (chemin d'argent).
  v_je := record_cash_wallet_movement_v2('undepo_to_petty', 1000, CURRENT_DATE, 'actor transverse', gen_random_uuid(), NULL);

  -- Variantes (dernier geste : le produit devient une variante).
  PERFORM convert_product_to_parent_v2((v_prod->'product'->>'id')::uuid, 'Regular', 'size', NULL);

  PERFORM set_config('apt.auth',  v_auth::text, TRUE);
  PERFORM set_config('apt.prof',  v_prof::text, TRUE);
  PERFORM set_config('apt.cat',   v_cat->>'id', TRUE);
  PERFORM set_config('apt.prod',  v_prod->'product'->>'id', TRUE);
  PERFORM set_config('apt.sec',   v_sec->>'id', TRUE);
  PERFORM set_config('apt.order', v_order::text, TRUE);
  PERFORM set_config('apt.order2', v_order2::text, TRUE);
  PERFORM set_config('apt.je',    v_je::text, TRUE);
END $fixture$;

-- T1 : le helper rend le profil, pas l'auth id.
SELECT is(_current_profile_id(), current_setting('apt.prof')::uuid,
  'T1: _current_profile_id() = user_profiles.id du compte id <> auth_user_id');

-- T2 : helper interne, révoqué.
SELECT ok(
  NOT has_function_privilege('anon', 'public._current_profile_id()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._current_profile_id()', 'EXECUTE'),
  'T2: _current_profile_id() n''est exécutable ni par anon ni par authenticated');

-- T3-T8 : catalogue.
SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'category.create'
     AND entity_id = current_setting('apt.cat')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T3: create_category_v2 — actor_id = profil (RED avant : 23503 sur v1)');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'product.create'
     AND entity_id = current_setting('apt.prod')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T4: create_product_v3 — actor_id = profil');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'product.update'
     AND entity_id = current_setting('apt.prod')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T5: update_product_v3 — actor_id = profil');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'product.set_test_flag'
     AND entity_id = current_setting('apt.prod')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T6: set_product_is_test_v2 — actor_id = profil');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'section.create'
     AND entity_id = current_setting('apt.sec')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T7: upsert_section_v2 — actor_id = profil');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'section.delete'
     AND entity_id = current_setting('apt.sec')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T8: delete_section_v2 — actor_id = profil');

-- T9-T11 : commandes.
SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'order.item.add'
     AND entity_id = current_setting('apt.order')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T9: add_order_item_v6 — actor_id = profil');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'order.item.remove'
     AND entity_id = current_setting('apt.order')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T10: remove_order_item_v4 — actor_id = profil');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'order.held_discarded'
     AND entity_id = current_setting('apt.order2')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T11: discard_held_order_v2 — actor_id = profil');

-- T12-T16 : imports.
SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'suppliers.imported'
     AND actor_id = current_setting('apt.prof')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T12: import_suppliers_v2 — actor_id = profil');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'sales.imported'
     AND actor_id = current_setting('apt.prof')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T13: import_sales_v2 — actor_id = profil');

SELECT is(
  (SELECT served_by FROM orders WHERE import_reference = 'ACT0906-S1' AND is_historical_import),
  current_setting('apt.prof')::uuid,
  'T14: import_sales_v2 — orders.served_by = profil (colonne FK métier, pas seulement la trace)');

SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'expenses.imported'
     AND actor_id = current_setting('apt.prof')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T15: import_expenses_v2 — actor_id = profil');

SELECT ok(
  (SELECT created_by = current_setting('apt.prof')::uuid
      AND submitted_by = current_setting('apt.prof')::uuid
      AND approved_by = current_setting('apt.prof')::uuid
      AND paid_by = current_setting('apt.prof')::uuid
     FROM expenses WHERE description = 'Actor expense 0906' AND is_historical_import),
  'T16: import_expenses_v2 — created_by / submitted_by / approved_by / paid_by = profil');

-- T17-T18 : coffre.
SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'cash.wallet_movement'
     AND entity_id = current_setting('apt.je')::uuid ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T17: record_cash_wallet_movement_v2 — actor_id = profil');

SELECT is(
  (SELECT created_by FROM journal_entries WHERE id = current_setting('apt.je')::uuid),
  current_setting('apt.prof')::uuid,
  'T18: record_cash_wallet_movement_v2 — journal_entries.created_by = profil (RED avant : 23503 sur v1)');

-- T19 : variantes.
SELECT is(
  (SELECT actor_id FROM audit_logs WHERE action = 'products.variant.parent_created'
     AND payload->>'first_variant_id' = current_setting('apt.prod') ORDER BY created_at DESC LIMIT 1),
  current_setting('apt.prof')::uuid,
  'T19: convert_product_to_parent_v2 — actor_id = profil');

-- T20 : aucune trace de ce fixture sans acteur.
SELECT is(
  (SELECT count(*) FROM audit_logs
    WHERE actor_id IS NULL AND created_at >= now() - interval '1 minute'
      AND action IN ('category.create','product.create','product.update','product.set_test_flag',
                     'section.create','section.delete','order.item.add','order.item.remove',
                     'order.held_discarded','suppliers.imported','sales.imported','expenses.imported',
                     'cash.wallet_movement','products.variant.parent_created')),
  0::bigint,
  'T20: aucune ligne d''audit du fixture ne porte un actor_id NULL');

-- T21-T23 : versioning monotone et grants.
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'add_order_item_v5','convert_parent_to_standalone_v1','convert_product_to_parent_v1','create_category_v1',
      'create_product_v2','create_variant_v1','delete_category_v1','delete_product_v1','delete_section_v1',
      'delete_variant_v1','discard_held_order_v1','import_catalog_v1','import_expenses_v1','import_purchases_v1',
      'import_sales_v1','import_suppliers_v1','recompute_all_recipe_costs_v1','recompute_recipe_cost_v1',
      'record_cash_wallet_movement_v1','remove_order_item_v3','reorder_categories_v1','reorder_variants_v1',
      'set_product_base_unit_v1','set_product_is_test_v1','set_product_sections_v1','set_product_units_v1',
      'update_category_v1','update_order_item_qty_v5','update_product_v2','update_variant_v1',
      'upsert_product_modifiers_v1','upsert_section_v1')),
  0::bigint,
  'T21: les 32 anciennes versions sont droppées');

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'add_order_item_v6','convert_parent_to_standalone_v2','convert_product_to_parent_v2','create_category_v2',
      'create_product_v3','create_variant_v2','delete_category_v2','delete_product_v2','delete_section_v2',
      'delete_variant_v2','discard_held_order_v2','import_catalog_v2','import_expenses_v2','import_purchases_v2',
      'import_sales_v2','import_suppliers_v2','recompute_all_recipe_costs_v3','recompute_recipe_cost_v3',
      'record_cash_wallet_movement_v2','remove_order_item_v4','reorder_categories_v2','reorder_variants_v2',
      'set_product_base_unit_v2','set_product_is_test_v2','set_product_sections_v2','set_product_units_v2',
      'update_category_v2','update_order_item_qty_v6','update_product_v3','update_variant_v2',
      'upsert_product_modifiers_v2','upsert_section_v2')),
  32::bigint,
  'T22: les 32 nouvelles versions existent');

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'add_order_item_v6','convert_parent_to_standalone_v2','convert_product_to_parent_v2','create_category_v2',
      'create_product_v3','create_variant_v2','delete_category_v2','delete_product_v2','delete_section_v2',
      'delete_variant_v2','discard_held_order_v2','import_catalog_v2','import_expenses_v2','import_purchases_v2',
      'import_sales_v2','import_suppliers_v2','recompute_all_recipe_costs_v3','recompute_recipe_cost_v3',
      'record_cash_wallet_movement_v2','remove_order_item_v4','reorder_categories_v2','reorder_variants_v2',
      'set_product_base_unit_v2','set_product_is_test_v2','set_product_sections_v2','set_product_units_v2',
      'update_category_v2','update_order_item_qty_v6','update_product_v3','update_variant_v2',
      'upsert_product_modifiers_v2','upsert_section_v2')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0::bigint,
  'T23: anon n''a EXECUTE sur aucune des 32 nouvelles versions');

-- T24 : cron.
SELECT is(
  (SELECT command FROM cron.job WHERE jobname = 'recompute-recipe-costs-daily'),
  'SELECT public.recompute_all_recipe_costs_v3();',
  'T24: le cron recompute-recipe-costs-daily appelle recompute_all_recipe_costs_v3');

-- T25-T26 : chemin sans contexte auth (cron, service_role).
SELECT set_config('request.jwt.claim.sub', '', TRUE);

SELECT is(_current_profile_id(), NULL::uuid,
  'T25: sans contexte auth, _current_profile_id() rend NULL et ne lève pas');

SELECT lives_ok(
  $$ SELECT recompute_recipe_cost_v3(current_setting('apt.prod')::uuid) $$,
  'T26: sans contexte auth, recompute_recipe_cost_v3 vit (chemin cron inchangé)');

-- T27 : achats importés (colonnes FK métier, revue du 2026-09-06).
SELECT ok(
  (SELECT created_by = current_setting('apt.prof')::uuid
      AND received_by = current_setting('apt.prof')::uuid
     FROM purchase_orders WHERE import_reference = 'ACT0906-PO1' AND is_historical_import),
  'T27: import_purchases_v2 — purchase_orders.created_by / received_by = profil');

SELECT * FROM finish();

ROLLBACK;
