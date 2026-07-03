-- supabase/tests/complete_order_v10_display.test.sql
-- ⚠️ OBSOLETE — candidate for dated exclusion (2026-07-04, S58 stale-suite triage).
-- Cette suite cible complete_order_with_payment_v10, DROPPÉE (money-path courante = v17, cf. S57).
-- Vérification sur v17 (repoint tenté) : T1 (double déduction display), T3 (current_stock peut
-- passer négatif si display suffit) et T4 (isolation non-display, aucun display_movements) sont
-- reproduits FIDÈLEMENT sous v17. Ces trois intentions sont déjà couvertes VERT par les suites
-- s44_display_symmetry et sale_stock_unification (S53 P1.4).
-- SEUL T2 n'est PAS reproductible sans réécrire l'assertion : v10 opposait une garde propre
-- « display_stock insuffisant » → P0002 ; v17 laisse l'oversell buter sur la CHECK brute
-- display_stock_quantity_check → SQLSTATE 23514 (l'oversell reste BLOQUÉ, mais le contrat
-- d'erreur a changé). Voir POSSIBLE REGRESSION dans le rapport S58 : garde d'oversell vitrine
-- dégradée d'un P0002 métier à une contrainte CHECK 23514.
-- => Fichier laissé INTACT (aucun repoint fabriqué). À exclure du run nightly ou à réécrire
--    délibérément (décision propriétaire) si la couverture des 3 intentions restantes est jugée
--    redondante avec les suites vertes ci-dessus.
--
-- pgTAP — vente v10 : double déduction display, garde vitrine, non-régression non-display.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(6);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_cat UUID; v_disp UUID; v_nondisp UUID; v_sess UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (sku,name,category_id,retail_price,cost_price,unit,is_display_item,current_stock)
    VALUES ('TST-V10-DISP','V10 Display',v_cat,20000,7000,'pcs',true,3) RETURNING id INTO v_disp;
  INSERT INTO products (sku,name,category_id,retail_price,cost_price,unit,is_display_item,current_stock)
    VALUES ('TST-V10-ND','V10 NonDisplay',v_cat,10000,4000,'pcs',false,50) RETURNING id INTO v_nondisp;

  PERFORM add_display_stock_v1(v_disp, 10, 'seed', gen_random_uuid());

  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;

  PERFORM set_config('breakery.v_disp', v_disp::text, true);
  PERFORM set_config('breakery.v_nondisp', v_nondisp::text, true);
  PERFORM set_config('breakery.v_sess', v_sess::text, true);
END $$;

-- T1 : vente d'un produit display → display_stock -2 ET current_stock -2
DO $$ DECLARE ds_before NUMERIC; ds_after NUMERIC; cs_before NUMERIC; cs_after NUMERIC;
BEGIN
  SELECT quantity INTO ds_before FROM display_stock WHERE product_id = current_setting('breakery.v_disp')::uuid;
  SELECT current_stock INTO cs_before FROM products WHERE id = current_setting('breakery.v_disp')::uuid;
  PERFORM complete_order_with_payment_v10(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_disp'), 'quantity', 2, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',40000,'cash_received',40000)
  );
  SELECT quantity INTO ds_after FROM display_stock WHERE product_id = current_setting('breakery.v_disp')::uuid;
  SELECT current_stock INTO cs_after FROM products WHERE id = current_setting('breakery.v_disp')::uuid;
  PERFORM set_config('breakery.t1ds', (ds_before - ds_after = 2)::text, true);
  PERFORM set_config('breakery.t1cs', (cs_before - cs_after = 2)::text, true);
END $$;
SELECT is(current_setting('breakery.t1ds'), 'true', 'T1 sale deducts display_stock by qty');
SELECT is(current_setting('breakery.t1cs'), 'true', 'T1 sale deducts current_stock by qty');

-- T2 : garde vitrine — vendre plus que display_stock → insufficient (P0002)
SELECT throws_ok(
  $$ SELECT complete_order_with_payment_v10(
       p_session_id := current_setting('breakery.v_sess')::uuid,
       p_order_type := 'take_out'::order_type,
       p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_disp'), 'quantity', 99999, 'unit_price', 20000)),
       p_payment := jsonb_build_object('method','cash','amount',1999980000,'cash_received',1999980000)) $$,
  'P0002', NULL, 'T2 sale blocked when display_stock insufficient');

-- T3 : current_stock display PEUT passer négatif si display_stock suffit
DO $$ DECLARE cs NUMERIC;
BEGIN
  UPDATE products SET current_stock = 1 WHERE id = current_setting('breakery.v_disp')::uuid;
  PERFORM complete_order_with_payment_v10(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_disp'), 'quantity', 3, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',60000,'cash_received',60000));
  SELECT current_stock INTO cs FROM products WHERE id = current_setting('breakery.v_disp')::uuid;
  PERFORM set_config('breakery.t3', (cs < 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t3'), 'true', 'T3 display sale lets current_stock go negative');

-- T4 : vente non-display → current_stock -q, AUCUN display_movements
DO $$ DECLARE cs_before NUMERIC; cs_after NUMERIC; dm_count INT;
BEGIN
  SELECT current_stock INTO cs_before FROM products WHERE id = current_setting('breakery.v_nondisp')::uuid;
  PERFORM complete_order_with_payment_v10(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_nondisp'), 'quantity', 4, 'unit_price', 10000)),
    p_payment := jsonb_build_object('method','cash','amount',40000,'cash_received',40000));
  SELECT current_stock INTO cs_after FROM products WHERE id = current_setting('breakery.v_nondisp')::uuid;
  SELECT count(*) INTO dm_count FROM display_movements WHERE product_id = current_setting('breakery.v_nondisp')::uuid;
  PERFORM set_config('breakery.t4cs', (cs_before - cs_after = 4)::text, true);
  PERFORM set_config('breakery.t4dm', (dm_count = 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t4cs'), 'true', 'T4 non-display sale deducts current_stock unchanged');
SELECT is(current_setting('breakery.t4dm'), 'true', 'T4 non-display sale writes no display_movements');

SELECT * FROM finish();
ROLLBACK;
