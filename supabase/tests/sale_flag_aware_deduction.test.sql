-- sale_flag_aware_deduction.test.sql
-- Vérifie la déduction flag-aware de complete_order_with_payment_v15 (Task 4) :
--   - café fait-à-la-commande (track=false, deduct=true) → cascade recette
--   - croissant pré-fait (track=true, deduct=true) → 1× le fini, pas les matières
--   - service (track=false, deduct=false) → rien
--   - réglage allow_negative_stock (blocage vs autorisation)
--
-- complete_order_with_payment_v15 exige auth.uid() → on simule le contexte JWT
-- d'un admin (EMP000) via set_config('request.jwt.claims', …, true). Lancer via
-- MCP execute_sql (enveloppe BEGIN … ROLLBACK portée par ce fichier).
--
-- Hypothèse de seed : EMP000 (auth_user_id 00000000-…-001) a la perm
-- pos.sale.create et une session POS ouverte (réutilisée, jamais committée).

BEGIN;
SELECT plan(6);
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

CREATE TEMP TABLE _r(label text, val numeric) ON COMMIT DROP;
DO $$
DECLARE
  v_cat uuid; v_admin uuid := '00000000-0000-0000-0000-000000000001';
  v_beans uuid := gen_random_uuid(); v_coffee uuid := gen_random_uuid();
  v_flour uuid := gen_random_uuid(); v_crois uuid := gen_random_uuid();
  v_service uuid := gen_random_uuid();
  v_milk uuid := gen_random_uuid(); v_latte uuid := gen_random_uuid();
  v_sess uuid; v_otype text; v_price numeric; v_blocked boolean := false;
BEGIN
  SELECT id INTO v_cat FROM categories LIMIT 1;
  SELECT enumlabel INTO v_otype FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='order_type' LIMIT 1;
  SELECT id INTO v_sess FROM pos_sessions WHERE opened_by=v_admin AND status='open' LIMIT 1;
  IF v_sess IS NULL THEN RAISE EXCEPTION 'fixture: EMP000 needs an open POS session'; END IF;

  INSERT INTO products (id, sku, name, category_id, retail_price, unit, track_inventory, deduct_stock, current_stock) VALUES
    (v_beans,  'TB-'||v_beans,  'Beans',  v_cat, 0,     'g',   true,  false, 1000),
    (v_coffee, 'TC-'||v_coffee, 'Coffee', v_cat, 20000, 'cup', false, true,  0),
    (v_flour,  'TF-'||v_flour,  'Flour',  v_cat, 0,     'g',   true,  false, 1000),
    (v_crois,  'TCR-'||v_crois, 'Croissant', v_cat, 15000, 'pcs', true, true, 10),
    (v_service,'TS-'||v_service,'Service', v_cat, 5000,  'pcs', false, false, 0),
    (v_milk,   'TM-'||v_milk,   'Milk',   v_cat, 0,     'ml',  true,  false, 1),
    (v_latte,  'TL-'||v_latte,  'Latte',  v_cat, 25000, 'cup', false, true,  0);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES
    (v_coffee, v_beans, 18,  'g',  true),
    (v_crois,  v_flour, 50,  'g',  true),
    (v_latte,  v_milk,  150, 'ml', true);

  -- A) Coffee (made-to-order)
  v_price := get_customer_product_price(v_coffee, NULL);
  PERFORM complete_order_with_payment_v15(
    p_session_id := v_sess, p_order_type := v_otype::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id',v_coffee,'quantity',1,'unit_price',v_price)),
    p_payment := jsonb_build_object('method','cash','amount',v_price,'cash_received',v_price,'change_given',0));
  INSERT INTO _r VALUES ('beans',(SELECT current_stock FROM products WHERE id=v_beans));
  INSERT INTO _r VALUES ('coffee',(SELECT current_stock FROM products WHERE id=v_coffee));

  -- B) Croissant (pre-made)
  v_price := get_customer_product_price(v_crois, NULL);
  PERFORM complete_order_with_payment_v15(
    p_session_id := v_sess, p_order_type := v_otype::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id',v_crois,'quantity',1,'unit_price',v_price)),
    p_payment := jsonb_build_object('method','cash','amount',v_price,'cash_received',v_price,'change_given',0));
  INSERT INTO _r VALUES ('crois',(SELECT current_stock FROM products WHERE id=v_crois));
  INSERT INTO _r VALUES ('flour',(SELECT current_stock FROM products WHERE id=v_flour));

  -- C) Service
  v_price := get_customer_product_price(v_service, NULL);
  PERFORM complete_order_with_payment_v15(
    p_session_id := v_sess, p_order_type := v_otype::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id',v_service,'quantity',1,'unit_price',v_price)),
    p_payment := jsonb_build_object('method','cash','amount',v_price,'cash_received',v_price,'change_given',0));
  INSERT INTO _r VALUES ('service',(SELECT current_stock FROM products WHERE id=v_service));

  -- D1) allow_negative = false → blocked
  v_price := get_customer_product_price(v_latte, NULL);
  UPDATE business_config SET allow_negative_stock=false WHERE id=1;
  BEGIN
    PERFORM complete_order_with_payment_v15(
      p_session_id := v_sess, p_order_type := v_otype::order_type,
      p_items := jsonb_build_array(jsonb_build_object('product_id',v_latte,'quantity',1,'unit_price',v_price)),
      p_payment := jsonb_build_object('method','cash','amount',v_price,'cash_received',v_price,'change_given',0));
    v_blocked := false;
  EXCEPTION WHEN OTHERS THEN v_blocked := (SQLSTATE='P0002');
  END;
  INSERT INTO _r VALUES ('blocked', v_blocked::int);

  -- D2) allow_negative = true → milk 1 - 150 = -149
  UPDATE business_config SET allow_negative_stock=true WHERE id=1;
  PERFORM complete_order_with_payment_v15(
    p_session_id := v_sess, p_order_type := v_otype::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id',v_latte,'quantity',1,'unit_price',v_price)),
    p_payment := jsonb_build_object('method','cash','amount',v_price,'cash_received',v_price,'change_given',0));
  INSERT INTO _r VALUES ('milk',(SELECT current_stock FROM products WHERE id=v_milk));
END $$;

SELECT is((SELECT val FROM _r WHERE label='beans'),   982::numeric,  'made-to-order coffee deducts recipe beans (1000-18)');
SELECT is((SELECT val FROM _r WHERE label='coffee'),  0::numeric,    'made-to-order coffee finished good not deducted');
SELECT is((SELECT val FROM _r WHERE label='crois'),   9::numeric,    'pre-made croissant finished good deducted (10-1)');
SELECT is((SELECT val FROM _r WHERE label='flour'),   1000::numeric, 'pre-made croissant raw material NOT deducted at sale');
SELECT is((SELECT val FROM _r WHERE label='service'), 0::numeric,    'service item deducts nothing');
SELECT ok((SELECT val FROM _r WHERE label='blocked')=1 AND (SELECT val FROM _r WHERE label='milk')=-149,
          'allow_negative_stock=false blocks; =true lets milk go to -149');

SELECT * FROM finish();
ROLLBACK;
