-- S1-09 et S1-12 — vente directe (famille complete_order_with_payment) :
--   S1-09 : la remise de ligne reste dans [0, sous-total serveur de SA ligne] ;
--   S1-12 : une promotion ciblée produit est calculée sur le prix du serveur,
--           quel que soit le prix unitaire envoyé par la caisse.
-- Fixtures dédiées, transaction annulée. Exécuter via MCP execute_sql.
BEGIN;
SELECT plan(13);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_mgr UUID; v_cat UUID; v_prod UUID; v_sess UUID; v_promo UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no profile with pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT up.id INTO v_mgr
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'sales.discount')
   LIMIT 1;
  IF v_mgr IS NULL THEN RAISE EXCEPTION 'fixture: no profile with sales.discount'; END IF;

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, current_stock)
    VALUES ('TST-S1-09-12', 'S1-09 S1-12 fixture', v_cat, 10000, 3000, 'pcs', 1000)
    RETURNING id INTO v_prod;

  SELECT id INTO v_sess FROM pos_sessions
   WHERE status = 'open' AND opened_by = v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  -- Seule la promotion du test est active dans la transaction.
  UPDATE promotions SET is_active = false WHERE is_active = true;
  INSERT INTO promotions (name, slug, type, scope, discount_value, scope_product_ids, is_active)
    VALUES ('S1-12 dix pour cent produit', 'tst-s1-12-product-pct', 'percentage', 'product', 10, ARRAY[v_prod], true)
    RETURNING id INTO v_promo;

  PERFORM set_config('s1.prod',  v_prod::text,  true);
  PERFORM set_config('s1.sess',  v_sess::text,  true);
  PERFORM set_config('s1.mgr',   v_mgr::text,   true);
  PERFORM set_config('s1.promo', v_promo::text, true);
END $$;

-- ===========================================================================
-- S1-09 — remise de ligne
-- ===========================================================================

-- T1 : remise supérieure au sous-total de la ligne → refusée.
SELECT throws_like(
  $q$ SELECT complete_order_with_payment_v33(
        p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
        p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s1.prod'),
                     'quantity', 1, 'unit_price', 10000, 'discount_amount', 10001)),
        p_payment := jsonb_build_object('method','cash','amount',0,'cash_received',0)) $q$,
  'line_discount_out_of_range%', 'T1 remise de ligne au-dessus du sous-total : refusée');

-- T2 : remise négative → refusée.
SELECT throws_like(
  $q$ SELECT complete_order_with_payment_v33(
        p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
        p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s1.prod'),
                     'quantity', 1, 'unit_price', 10000, 'discount_amount', -1)),
        p_payment := jsonb_build_object('method','cash','amount',10001,'cash_received',10001)) $q$,
  'line_discount_out_of_range%', 'T2 remise de ligne négative : refusée');

-- T3 : le plafond est celui de LA ligne, pas de la commande. Une ligne de
-- 20 000 sans remise ne couvre pas une remise de 15 000 sur une ligne de 10 000.
SELECT throws_like(
  $q$ SELECT complete_order_with_payment_v33(
        p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', current_setting('s1.prod'), 'quantity', 2, 'unit_price', 10000),
          jsonb_build_object('product_id', current_setting('s1.prod'), 'quantity', 1, 'unit_price', 10000, 'discount_amount', 15000)),
        p_payment := jsonb_build_object('method','cash','amount',15000,'cash_received',15000)) $q$,
  'line_discount_out_of_range%', 'T3 le plafond est par ligne, pas par commande');

-- T4 : le plafond se lit sur le prix du SERVEUR. Un prix client gonflé à
-- 100 000 n'autorise pas une remise de 50 000 sur une ligne qui vaut 10 000.
SELECT throws_like(
  $q$ SELECT complete_order_with_payment_v33(
        p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
        p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s1.prod'),
                     'quantity', 1, 'unit_price', 100000, 'discount_amount', 50000)),
        p_payment := jsonb_build_object('method','cash','amount',50000,'cash_received',50000)) $q$,
  'line_discount_out_of_range%', 'T4 le plafond ignore le prix envoyé par la caisse');

-- T5 : remise égale au sous-total de la ligne → acceptée (avec autorisation).
DO $$ DECLARE v_res JSONB; v_nonce UUID; v_line NUMERIC;
BEGIN
  INSERT INTO discount_authorizations (manager_profile_id)
    VALUES (current_setting('s1.mgr')::uuid) RETURNING id INTO v_nonce;
  v_res := complete_order_with_payment_v33(
    p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id', current_setting('s1.prod'), 'quantity', 1, 'unit_price', 10000),
      jsonb_build_object('product_id', current_setting('s1.prod'), 'quantity', 1, 'unit_price', 10000, 'discount_amount', 10000)),
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000),
    p_discount_authorized_by := current_setting('s1.mgr')::uuid,
    p_discount_auth_id := v_nonce);
  SELECT min(line_total) INTO v_line FROM order_items WHERE order_id = (v_res->>'order_id')::uuid;
  PERFORM set_config('s1.t5_total', v_res->>'total', true);
  PERFORM set_config('s1.t5_line', v_line::text, true);
END $$;
SELECT is(current_setting('s1.t5_total')::numeric, 10000::numeric, 'T5 remise égale au sous-total de la ligne : acceptée');
SELECT is(current_setting('s1.t5_line')::numeric, 0::numeric, 'T5 la ligne remisée vaut zéro, jamais moins');

-- T6 : sans remise → acceptée, sans autorisation.
DO $$ DECLARE v_res JSONB;
BEGIN
  v_res := complete_order_with_payment_v33(
    p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s1.prod'),
                 'quantity', 1, 'unit_price', 10000, 'discount_amount', 0)),
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000));
  PERFORM set_config('s1.t6_total', v_res->>'total', true);
END $$;
SELECT is(current_setting('s1.t6_total')::numeric, 10000::numeric, 'T6 remise de ligne à zéro : acceptée');

-- ===========================================================================
-- S1-12 — promotion ciblée produit, 10 % sur un produit à 10 000
-- ===========================================================================

-- T7 : prix client falsifié à 100 000, remise déclarée 10 000 (10 % du faux
-- prix) → refusée : le serveur calcule 1 000.
SELECT throws_like(
  $q$ SELECT complete_order_with_payment_v33(
        p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
        p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s1.prod'),
                     'quantity', 1, 'unit_price', 100000)),
        p_payment := jsonb_build_object('method','cash','amount',0,'cash_received',0),
        p_promotions := jsonb_build_array(jsonb_build_object(
                     'promotion_id', current_setting('s1.promo'), 'amount', 10000))) $q$,
  'Promotion amount mismatch%', 'T7 remise calculée sur un prix client falsifié : refusée');

-- T8 : même prix falsifié, remise déclarée 1 000 → acceptée, et c'est 1 000
-- qui s'applique.
DO $$ DECLARE v_res JSONB;
BEGIN
  v_res := complete_order_with_payment_v33(
    p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s1.prod'),
                 'quantity', 1, 'unit_price', 100000)),
    p_payment := jsonb_build_object('method','cash','amount',9000,'cash_received',9000),
    p_promotions := jsonb_build_array(jsonb_build_object(
                 'promotion_id', current_setting('s1.promo'), 'amount', 1000)));
  PERFORM set_config('s1.t8_promo', v_res->>'promotion_total', true);
  PERFORM set_config('s1.t8_total', v_res->>'total', true);
END $$;
SELECT is(current_setting('s1.t8_promo')::numeric, 1000::numeric, 'T8 prix client falsifié : la promotion applique 1 000, pas 10 000');
SELECT is(current_setting('s1.t8_total')::numeric, 9000::numeric, 'T8 le total suit le prix du serveur');

-- T9 : caisse honnête → comportement inchangé.
DO $$ DECLARE v_res JSONB;
BEGIN
  v_res := complete_order_with_payment_v33(
    p_session_id := current_setting('s1.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s1.prod'),
                 'quantity', 2, 'unit_price', 10000)),
    p_payment := jsonb_build_object('method','cash','amount',18000,'cash_received',18000),
    p_promotions := jsonb_build_array(jsonb_build_object(
                 'promotion_id', current_setting('s1.promo'), 'amount', 2000)));
  PERFORM set_config('s1.t9_total', v_res->>'total', true);
END $$;
SELECT is(current_setting('s1.t9_total')::numeric, 18000::numeric, 'T9 prix client exact : la promotion passe comme avant');

-- ===========================================================================
-- Structure
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'public' AND p.proname = 'complete_order_with_payment_v32')
       OR (n.nspname = 'stock_private' AND p.proname = 'complete_order_with_payment_v30')),
  0, 'T10 les versions précédentes, publique et privée, sont retirées');

SELECT ok(
  NOT has_function_privilege('anon', 'public.complete_order_with_payment_v33(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'stock_private.complete_order_with_payment_v33(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.complete_order_with_payment_v33(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text)', 'EXECUTE'),
  'T11 anon refusé, corps privé fermé à authenticated, façade ouverte à authenticated');

SELECT * FROM finish();
ROLLBACK;
