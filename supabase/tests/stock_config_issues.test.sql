-- supabase/tests/stock_config_issues.test.sql
-- Audit 2026-07-08 — get_stock_config_issues_v1 (alerte "produits mal configurés").
-- Run via Supabase MCP execute_sql (Docker retired). BEGIN..ROLLBACK envelope.
-- _r capture pattern (le MCP n'echo que la derniere ligne).
BEGIN;
SELECT plan(7);
CREATE TEMP TABLE _r(l text);

-- Existence + ACL defense-in-depth
INSERT INTO _r SELECT has_function('public', 'get_stock_config_issues_v1', ARRAY[]::text[],
  'T1: get_stock_config_issues_v1 exists (0 args)');
INSERT INTO _r SELECT ok(NOT has_function_privilege('anon', 'get_stock_config_issues_v1()', 'EXECUTE'),
  'T2: anon EXECUTE revoked');
INSERT INTO _r SELECT ok(has_function_privilege('authenticated', 'get_stock_config_issues_v1()', 'EXECUTE'),
  'T3: authenticated EXECUTE granted');

-- Acteur : un user seedé qui a inventory.read
DO $$
DECLARE v_auth UUID; v_cat UUID; v_mat UUID;
        v_mto UUID; v_orphan UUID; v_neg UUID; v_prod UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'inventory.read') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  -- matière première partagée (track=true, pas de recette, stock 0 -> aucun issue propre)
  INSERT INTO products (sku, name, category_id, retail_price, unit, current_stock, track_inventory, deduct_stock)
    VALUES ('SCI-MAT', 'SCI material', v_cat, 0, 'kg', 100, true, true) RETURNING id INTO v_mat;

  -- P1 : fait-à-la-commande SANS recette -> sale_deduct_no_recipe
  INSERT INTO products (sku, name, category_id, retail_price, unit, current_stock, track_inventory, deduct_stock)
    VALUES ('SCI-MTO', 'SCI made-to-order', v_cat, 1000, 'pcs', 0, false, true) RETURNING id INTO v_mto;

  -- P2 : recette définie mais deduct_stock=false -> orphan_recipe
  INSERT INTO products (sku, name, category_id, retail_price, unit, current_stock, track_inventory, deduct_stock)
    VALUES ('SCI-ORPH', 'SCI orphan recipe', v_cat, 1000, 'pcs', 0, false, false) RETURNING id INTO v_orphan;
  INSERT INTO recipes (product_id, material_id, quantity, unit) VALUES (v_orphan, v_mat, 1, 'kg');

  -- P3 : suivi au stock négatif -> negative_stock (critical)
  INSERT INTO products (sku, name, category_id, retail_price, unit, current_stock, track_inventory, deduct_stock)
    VALUES ('SCI-NEG', 'SCI negative', v_cat, 1000, 'pcs', -5, true, true) RETURNING id INTO v_neg;

  -- P4 : suivi + recette + vendu + pas ingrédient -> tracked_recipe_at_prod (info)
  INSERT INTO products (sku, name, category_id, retail_price, unit, current_stock, track_inventory, deduct_stock)
    VALUES ('SCI-PROD', 'SCI tracked recipe', v_cat, 1000, 'pcs', 0, true, true) RETURNING id INTO v_prod;
  INSERT INTO recipes (product_id, material_id, quantity, unit) VALUES (v_prod, v_mat, 1, 'kg');
END $$;

INSERT INTO _r SELECT is(
  (SELECT issue_type FROM get_stock_config_issues_v1() WHERE sku='SCI-MTO'),
  'sale_deduct_no_recipe', 'T4: made-to-order sans recette -> sale_deduct_no_recipe');
INSERT INTO _r SELECT is(
  (SELECT issue_type FROM get_stock_config_issues_v1() WHERE sku='SCI-ORPH'),
  'orphan_recipe', 'T5: recette + deduct=false -> orphan_recipe');
INSERT INTO _r SELECT is(
  (SELECT severity FROM get_stock_config_issues_v1() WHERE sku='SCI-NEG'),
  'critical', 'T6: stock négatif suivi -> severity critical');
INSERT INTO _r SELECT is(
  (SELECT issue_type FROM get_stock_config_issues_v1() WHERE sku='SCI-PROD'),
  'tracked_recipe_at_prod', 'T7: suivi + recette vendu -> tracked_recipe_at_prod');

SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _r;
ROLLBACK;
