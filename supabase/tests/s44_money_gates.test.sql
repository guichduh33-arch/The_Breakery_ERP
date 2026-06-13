-- supabase/tests/s44_money_gates.test.sql
-- S44 money-path hardening gates : get_loyalty_multiplier (Wave A) +
-- complete_order_with_payment_v12 (Wave B : P0-A sequencing, change gate,
-- promo recompute, DB multiplier, honest replay). Cas v8/fire_v2 dans
-- s44_display_symmetry.test.sql. Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
-- Pattern jwt-claims S37/S43 (counter_fire) + GUC pass-flag S25 (DEV-S25-2.A-03).
BEGIN;
SELECT plan(12);

DO $$
DECLARE v_auth UUID; v_prof UUID; v_sess UUID; v_prod UUID; v_cat UUID; v_cust UUID; v_promo UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no user_profiles row with pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess; END IF;

  -- Produit déterministe : non-display, gros stock, retail 35000 (rollback).
  SELECT id INTO v_prod FROM products WHERE deleted_at IS NULL AND parent_product_id IS NULL AND is_active=true LIMIT 1;
  UPDATE products SET is_display_item=false, current_stock=1000, retail_price=35000 WHERE id=v_prod;

  -- Catégorie client multiplier 2.0 + client silver (lifetime 600).
  INSERT INTO customer_categories (name, slug, points_multiplier) VALUES ('S44 Test Cat', 's44-test-cat', 2.0) RETURNING id INTO v_cat;
  INSERT INTO customers (name, category_id, lifetime_points, loyalty_points) VALUES ('S44 Test Cust', v_cat, 600, 600) RETURNING id INTO v_cust;

  -- Isole l'éval promo : désactive toutes les autres promos, insère une percentage cart 10 %.
  UPDATE promotions SET is_active=false WHERE is_active=true;
  INSERT INTO promotions (name, slug, type, scope, discount_value, day_of_week_mask, min_items_total, priority, is_active)
    VALUES ('S44 Promo', 's44-promo', 'percentage', 'cart', 10, 127, 0, 100, true) RETURNING id INTO v_promo;

  PERFORM set_config('s44.session_id', v_sess::text, true);
  PERFORM set_config('s44.prod', v_prod::text, true);
  PERFORM set_config('s44.cust', v_cust::text, true);
  PERFORM set_config('s44.promo', v_promo::text, true);
END $$;

-- T1-T5 : get_loyalty_multiplier pinne le miroir SQL de tiers.ts (sync : tiers-multipliers.test.ts).
SELECT is(get_loyalty_multiplier(0),    1.0::numeric, 'T1 bronze floor');
SELECT is(get_loyalty_multiplier(499),  1.0::numeric, 'T2 bronze ceiling');
SELECT is(get_loyalty_multiplier(500),  1.05::numeric, 'T3 silver boundary');
SELECT is(get_loyalty_multiplier(2000), 1.1::numeric, 'T4 gold boundary');
SELECT is(get_loyalty_multiplier(5000), 1.2::numeric, 'T5 platinum boundary');

-- T6 : change forgé sur tender cash ⇒ 'Invalid change amount'.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM complete_order_with_payment_v12(
      p_session_id := current_setting('s44.session_id')::uuid, p_order_type := 'take_out',
      p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s44.prod')::uuid, 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',50000,'change_given',20000));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('s44.t6', (v_msg ILIKE '%Invalid change amount%')::text, true);
END $$;
SELECT ok(current_setting('s44.t6')::boolean, 'T6 forged cash change rejected');

-- T7 : change sur tender non-cash ⇒ 'non-cash tender cannot give change'.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM complete_order_with_payment_v12(
      p_session_id := current_setting('s44.session_id')::uuid, p_order_type := 'take_out',
      p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s44.prod')::uuid, 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','qris','amount',35000,'change_given',5000));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('s44.t7', (v_msg ILIKE '%Invalid change amount%')::text, true);
END $$;
SELECT ok(current_setting('s44.t7')::boolean, 'T7 non-cash change rejected');

-- T8 : happy cash ⇒ JE 'sale' débite le compte cash + AUCUN fallback (P0-A sequencing) + enveloppe change réel.
DO $$ DECLARE v_env JSONB; v_oid UUID; v_cash UUID; v_dbt INT; v_fb INT;
BEGIN
  v_env := complete_order_with_payment_v12(
    p_session_id := current_setting('s44.session_id')::uuid, p_order_type := 'take_out',
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s44.prod')::uuid, 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',50000,'change_given',15000));
  v_oid := (v_env->>'order_id')::uuid;
  v_cash := resolve_mapping_account('SALE_PAYMENT_CASH');
  SELECT count(*) INTO v_dbt FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_oid AND jel.account_id=v_cash AND jel.debit=35000;
  SELECT count(*) INTO v_fb FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_oid AND jel.description ILIKE '%fallback to cash%';
  PERFORM set_config('s44.t8', (v_dbt=1 AND v_fb=0 AND (v_env->>'change_given')::numeric=15000 AND (SELECT status FROM orders WHERE id=v_oid)='paid')::text, true);
END $$;
SELECT ok(current_setting('s44.t8')::boolean, 'T8 cash sale: JE cash debit, no fallback, real change, paid');

-- T9 : replay même idempotency_key ⇒ idempotent_replay + change_given réel.
DO $$ DECLARE v_key UUID := gen_random_uuid(); v_e1 JSONB; v_e2 JSONB;
BEGIN
  v_e1 := complete_order_with_payment_v12(
    p_session_id := current_setting('s44.session_id')::uuid, p_order_type := 'take_out',
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s44.prod')::uuid, 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',50000,'change_given',15000),
    p_idempotency_key := v_key);
  v_e2 := complete_order_with_payment_v12(
    p_session_id := current_setting('s44.session_id')::uuid, p_order_type := 'take_out',
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s44.prod')::uuid, 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',50000,'change_given',15000),
    p_idempotency_key := v_key);
  PERFORM set_config('s44.t9', ((v_e2->>'idempotent_replay')='true' AND (v_e2->>'change_given')::numeric=15000)::text, true);
END $$;
SELECT ok(current_setting('s44.t9')::boolean, 'T9 replay envelope: idempotent + real change');

-- T10 : promo montant exact 3500 (10 % de 35000) ⇒ PASS, promotion_applications.amount=3500.
DO $$ DECLARE v_env JSONB; v_oid UUID; v_amt INT;
BEGIN
  v_env := complete_order_with_payment_v12(
    p_session_id := current_setting('s44.session_id')::uuid, p_order_type := 'take_out',
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s44.prod')::uuid, 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',31500,'cash_received',31500,'change_given',0),
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('s44.promo')::uuid, 'amount', 3500)));
  v_oid := (v_env->>'order_id')::uuid;
  SELECT amount::int INTO v_amt FROM promotion_applications WHERE order_id=v_oid AND promotion_id=current_setting('s44.promo')::uuid;
  PERFORM set_config('s44.t10', (v_amt=3500 AND (v_env->>'promotion_total')::numeric=3500)::text, true);
END $$;
SELECT ok(current_setting('s44.t10')::boolean, 'T10 promo exact amount applied');

-- T11 : promo montant forgé 10000 ⇒ 'Promotion amount mismatch'.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM complete_order_with_payment_v12(
      p_session_id := current_setting('s44.session_id')::uuid, p_order_type := 'take_out',
      p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s44.prod')::uuid, 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',25000,'cash_received',25000,'change_given',0),
      p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('s44.promo')::uuid, 'amount', 10000)));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('s44.t11', (v_msg ILIKE '%Promotion amount mismatch%')::text, true);
END $$;
SELECT ok(current_setting('s44.t11')::boolean, 'T11 forged promo amount rejected');

-- T12 : multiplier DB ⇒ points = FLOOR(35000 * 1.05 (silver 600) * 2.0 (cat) / 1000) = 73.
DO $$ DECLARE v_env JSONB; v_oid UUID; v_pts INT;
BEGIN
  v_env := complete_order_with_payment_v12(
    p_session_id := current_setting('s44.session_id')::uuid, p_order_type := 'take_out',
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('s44.prod')::uuid, 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',35000,'change_given',0),
    p_customer_id := current_setting('s44.cust')::uuid);
  v_oid := (v_env->>'order_id')::uuid;
  SELECT loyalty_points_earned INTO v_pts FROM orders WHERE id=v_oid;
  PERFORM set_config('s44.t12', (v_pts=73 AND (v_env->>'loyalty_points_earned')::numeric=73)::text, true);
END $$;
SELECT ok(current_setting('s44.t12')::boolean, 'T12 loyalty multiplier resolved server-side (73 pts)');

SELECT * FROM finish();
ROLLBACK;
