-- Regression : totaux des commandes tablette a la creation et a l'ajout.
BEGIN;
SELECT plan(9);

CREATE TEMP TABLE tablet_totals_fixture (order_id uuid, product_id uuid, replay_key uuid);
DO $fixture$
DECLARE
  v_auth uuid; v_product uuid; v_order uuid; v_key uuid := gen_random_uuid();
BEGIN
  SELECT auth_user_id INTO v_auth FROM user_profiles
  WHERE deleted_at IS NULL AND auth_user_id IS NOT NULL
    AND has_permission(auth_user_id, 'sales.create') LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: sales.create profile required'; END IF;
  SELECT id INTO v_product FROM products
  WHERE is_active AND deleted_at IS NULL AND product_type <> 'combo' LIMIT 1;
  IF v_product IS NULL THEN RAISE EXCEPTION 'fixture: product required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_auth)::text, true);
  v_order := create_tablet_order_v12(v_key, NULL, 'TEST-TOTALS', 'dine_in',
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2,'unit_price',40000)),
    NULL, NULL, true);
  INSERT INTO tablet_totals_fixture VALUES(v_order,v_product,v_key);
END $fixture$;

SELECT is((SELECT total FROM orders WHERE id=(SELECT order_id FROM tablet_totals_fixture)),
  (SELECT total FROM _pb1_split_v1(80000)), 'creation : total avec mode PB1 courant');
SELECT is((SELECT subtotal FROM orders WHERE id=(SELECT order_id FROM tablet_totals_fixture)),
  (SELECT subtotal FROM _pb1_split_v1(80000)), 'creation : sous-total avec mode PB1 courant');
SELECT is((SELECT tax_amount FROM orders WHERE id=(SELECT order_id FROM tablet_totals_fixture)),
  (SELECT tax_amount FROM _pb1_split_v1(80000)), 'creation : taxe avec mode PB1 courant');

DO $replay$
DECLARE v_result uuid; v_fixture record;
BEGIN
  SELECT * INTO v_fixture FROM tablet_totals_fixture;
  v_result := create_tablet_order_v12(v_fixture.replay_key,NULL,'TEST-TOTALS','dine_in',
    jsonb_build_array(jsonb_build_object('product_id',v_fixture.product_id,'quantity',2,'unit_price',40000)),
    NULL,NULL,true);
  IF v_result <> v_fixture.order_id THEN RAISE EXCEPTION 'Replay changed order'; END IF;
END $replay$;
SELECT is((SELECT count(*) FROM order_items WHERE order_id=(SELECT order_id FROM tablet_totals_fixture)),
  1::bigint,'rejeu creation : aucune ligne dupliquee');

DO $append$
DECLARE v_fixture record; v_key uuid := gen_random_uuid(); v_items jsonb;
BEGIN
  SELECT * INTO v_fixture FROM tablet_totals_fixture;
  v_items := jsonb_build_array(jsonb_build_object('product_id',v_fixture.product_id,'quantity',1,'unit_price',15000));
  PERFORM create_tablet_order_v12(v_key,NULL,'TEST-TOTALS','dine_in',v_items,NULL,v_fixture.order_id,true);
  PERFORM create_tablet_order_v12(v_key,NULL,'TEST-TOTALS','dine_in',v_items,NULL,v_fixture.order_id,true);
END $append$;
SELECT is((SELECT total FROM orders WHERE id=(SELECT order_id FROM tablet_totals_fixture)),
  (SELECT total FROM _pb1_split_v1(95000)), 'ajout : total de toutes les lignes');
SELECT is((SELECT count(*) FROM order_items WHERE order_id=(SELECT order_id FROM tablet_totals_fixture)),
  2::bigint,'rejeu ajout : aucune ligne dupliquee');

SELECT ok(NOT has_function_privilege('anon',
  'public.create_tablet_order_v12(uuid,uuid,text,order_type,jsonb,text,uuid,boolean,text,uuid)','EXECUTE'),
  'anon ne peut pas creer de commande');
SELECT ok(has_function_privilege('authenticated',
  'public.create_tablet_order_v12(uuid,uuid,text,order_type,jsonb,text,uuid,boolean,text,uuid)','EXECUTE'),
  'authenticated conserve son droit RPC');
SELECT ok(to_regprocedure('public.create_tablet_order_v10(uuid,uuid,text,order_type,jsonb,text,uuid,boolean,text,uuid)') IS NULL,
  'ancienne version retiree');
SELECT * FROM finish();
ROLLBACK;
