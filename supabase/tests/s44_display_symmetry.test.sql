-- supabase/tests/s44_display_symmetry.test.sql
-- S44 Wave B/D — pay_existing_order_v8 : display_stock parity (P1-C), JE split
-- par méthode (P0-A), change gate / promo recompute / multiplier (P0-C),
-- replay honnête (OPP-1) + (Wave D) reversal display_stock void.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK). Pattern jwt-claims + GUC S25.
BEGIN;
SELECT plan(8);

DO $$
DECLARE v_auth UUID; v_prof UUID; v_sess UUID; v_disp UUID; v_norm UUID; v_cat UUID; v_cust UUID; v_promo UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'payments.process')
     AND has_permission(up.auth_user_id, 'pos.sale.create') LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no profile with payments.process+pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess; END IF;

  -- Produit vitrine : display_stock=10.
  SELECT id INTO v_disp FROM products WHERE deleted_at IS NULL AND parent_product_id IS NULL AND is_active=true LIMIT 1;
  UPDATE products SET is_display_item=true, current_stock=100, retail_price=20000 WHERE id=v_disp;
  INSERT INTO display_stock (product_id, quantity) VALUES (v_disp, 10)
    ON CONFLICT (product_id) DO UPDATE SET quantity=10;

  -- Produit normal (non-display).
  SELECT id INTO v_norm FROM products WHERE deleted_at IS NULL AND parent_product_id IS NULL AND is_active=true AND id <> v_disp LIMIT 1;
  UPDATE products SET is_display_item=false, current_stock=1000, retail_price=35000 WHERE id=v_norm;

  INSERT INTO customer_categories (name, slug, points_multiplier) VALUES ('S44 Sym Cat', 's44-sym-cat', 2.0) RETURNING id INTO v_cat;
  INSERT INTO customers (name, category_id, lifetime_points, loyalty_points) VALUES ('S44 Sym Cust', v_cat, 600, 600) RETURNING id INTO v_cust;

  UPDATE promotions SET is_active=false WHERE is_active=true;
  INSERT INTO promotions (name, slug, type, scope, discount_value, day_of_week_mask, min_items_total, priority, is_active)
    VALUES ('S44 Sym Promo', 's44-sym-promo', 'percentage', 'cart', 10, 127, 0, 100, true) RETURNING id INTO v_promo;

  PERFORM set_config('s44.session_id', v_sess::text, true);
  PERFORM set_config('s44.disp', v_disp::text, true);
  PERFORM set_config('s44.norm', v_norm::text, true);
  PERFORM set_config('s44.cust', v_cust::text, true);
  PERFORM set_config('s44.promo', v_promo::text, true);
  PERFORM set_config('s44.prof', v_prof::text, true);
END $$;

-- Helper : crée un ordre comptoir pending_payment pos avec 1 item.
CREATE OR REPLACE FUNCTION pg_temp._mk_order(p_prod UUID, p_price NUMERIC, p_qty NUMERIC, p_num TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_oid UUID;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES (p_num, current_setting('s44.session_id')::uuid, current_setting('s44.prof')::uuid, 'take_out',
            'pending_payment', p_price*p_qty, 0, p_price*p_qty, 'pos') RETURNING id INTO v_oid;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_oid, p_prod, 'snap', p_price, p_qty, p_price*p_qty);
  RETURN v_oid;
END $$;

-- T1 : v8 paie un ordre display (qty 2) ⇒ display_stock 10→8 + display_movements 'sale' + stock_movements 'sale'.
DO $$ DECLARE v_oid UUID; v_q INT; v_dm INT; v_sm INT;
BEGIN
  v_oid := pg_temp._mk_order(current_setting('s44.disp')::uuid, 20000, 2, '#SYM1');
  PERFORM pay_existing_order_v8(p_order_id := v_oid, p_payment := jsonb_build_object('method','cash','amount',40000,'cash_received',40000,'change_given',0));
  SELECT quantity::int INTO v_q FROM display_stock WHERE product_id=current_setting('s44.disp')::uuid;
  SELECT count(*) INTO v_dm FROM display_movements WHERE reference_id=v_oid AND movement_type='sale' AND product_id=current_setting('s44.disp')::uuid;
  SELECT count(*) INTO v_sm FROM stock_movements WHERE reference_id=v_oid AND movement_type='sale' AND product_id=current_setting('s44.disp')::uuid;
  PERFORM set_config('s44.t1', (v_q=8 AND v_dm=1 AND v_sm=1)::text, true);
END $$;
SELECT ok(current_setting('s44.t1')::boolean, 'T1 v8 display sale: display_stock decremented + both ledgers');

-- T2 : v8 paie un ordre non-display ⇒ aucune ligne display_movements fantôme.
DO $$ DECLARE v_oid UUID; v_dm INT;
BEGIN
  v_oid := pg_temp._mk_order(current_setting('s44.norm')::uuid, 35000, 1, '#SYM2');
  PERFORM pay_existing_order_v8(p_order_id := v_oid, p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',35000,'change_given',0));
  SELECT count(*) INTO v_dm FROM display_movements WHERE reference_id=v_oid;
  PERFORM set_config('s44.t2', (v_dm=0)::text, true);
END $$;
SELECT ok(current_setting('s44.t2')::boolean, 'T2 v8 non-display sale: no phantom display movement');

-- T3 : v8 qris ⇒ JE 'sale' débite le compte QRIS + AUCUN fallback cash (P0-A).
DO $$ DECLARE v_oid UUID; v_qris UUID; v_n INT; v_fb INT;
BEGIN
  v_oid := pg_temp._mk_order(current_setting('s44.norm')::uuid, 35000, 1, '#SYM3');
  PERFORM pay_existing_order_v8(p_order_id := v_oid, p_payment := jsonb_build_object('method','qris','amount',35000));
  v_qris := resolve_mapping_account('SALE_PAYMENT_QRIS');
  SELECT count(*) INTO v_n FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_oid AND jel.account_id=v_qris AND jel.debit=35000;
  SELECT count(*) INTO v_fb FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_oid AND jel.description ILIKE '%fallback to cash%';
  PERFORM set_config('s44.t3', (v_n=1 AND v_fb=0)::text, true);
END $$;
SELECT ok(current_setting('s44.t3')::boolean, 'T3 v8 qris sale: JE debits QRIS, no fallback');

-- T4 : v8 change forgé sur tender cash ⇒ 'Invalid change amount'.
DO $$ DECLARE v_oid UUID; v_msg TEXT := '';
BEGIN
  v_oid := pg_temp._mk_order(current_setting('s44.norm')::uuid, 35000, 1, '#SYM4');
  BEGIN PERFORM pay_existing_order_v8(p_order_id := v_oid, p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',50000,'change_given',20000));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('s44.t4', (v_msg ILIKE '%Invalid change amount%')::text, true);
END $$;
SELECT ok(current_setting('s44.t4')::boolean, 'T4 v8 forged cash change rejected');

-- T5 : v8 promo montant forgé ⇒ 'Promotion amount mismatch'.
DO $$ DECLARE v_oid UUID; v_msg TEXT := '';
BEGIN
  v_oid := pg_temp._mk_order(current_setting('s44.norm')::uuid, 35000, 1, '#SYM5');
  BEGIN PERFORM pay_existing_order_v8(p_order_id := v_oid,
    p_payment := jsonb_build_object('method','cash','amount',25000,'cash_received',25000,'change_given',0),
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('s44.promo')::uuid, 'amount', 10000)));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('s44.t5', (v_msg ILIKE '%Promotion amount mismatch%')::text, true);
END $$;
SELECT ok(current_setting('s44.t5')::boolean, 'T5 v8 forged promo rejected');

-- T6 : v8 multiplier DB ⇒ points = FLOOR(35000 * 1.05 * 2.0 / 1000) = 73 (signature sans p_loyalty_multiplier).
DO $$ DECLARE v_oid UUID; v_env JSONB; v_pts INT;
BEGIN
  v_oid := pg_temp._mk_order(current_setting('s44.norm')::uuid, 35000, 1, '#SYM6');
  v_env := pay_existing_order_v8(p_order_id := v_oid,
    p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',35000,'change_given',0),
    p_customer_id := current_setting('s44.cust')::uuid);
  SELECT loyalty_points_earned INTO v_pts FROM orders WHERE id=v_oid;
  PERFORM set_config('s44.t6', (v_pts=73 AND (v_env->>'loyalty_points_earned')::numeric=73)::text, true);
END $$;
SELECT ok(current_setting('s44.t6')::boolean, 'T6 v8 loyalty multiplier server-side (73 pts)');

-- T7 : v8 replay ⇒ enveloppe honnête (idempotent_replay + change_given réel).
DO $$ DECLARE v_oid UUID; v_key UUID := gen_random_uuid(); v_e1 JSONB; v_e2 JSONB;
BEGIN
  v_oid := pg_temp._mk_order(current_setting('s44.norm')::uuid, 35000, 1, '#SYM7');
  v_e1 := pay_existing_order_v8(p_order_id := v_oid,
    p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',50000,'change_given',15000), p_idempotency_key := v_key);
  v_e2 := pay_existing_order_v8(p_order_id := v_oid,
    p_payment := jsonb_build_object('method','cash','amount',35000,'cash_received',50000,'change_given',15000), p_idempotency_key := v_key);
  PERFORM set_config('s44.t7', ((v_e2->>'idempotent_replay')='true' AND (v_e2->>'change_given')::numeric=15000)::text, true);
END $$;
SELECT ok(current_setting('s44.t7')::boolean, 'T7 v8 replay envelope honest');

-- T8 : (Wave D) void d'une vente display restaure display_stock + display_movements 'sale_void'.
DO $$ DECLARE v_oid UUID; v_q0 INT; v_q1 INT; v_vm INT;
BEGIN
  v_oid := pg_temp._mk_order(current_setting('s44.disp')::uuid, 20000, 1, '#SYM8');
  PERFORM pay_existing_order_v8(p_order_id := v_oid, p_payment := jsonb_build_object('method','cash','amount',20000,'cash_received',20000,'change_given',0));
  SELECT quantity::int INTO v_q0 FROM display_stock WHERE product_id=current_setting('s44.disp')::uuid;
  UPDATE orders SET status='voided', voided_at=now(), voided_by=current_setting('s44.prof')::uuid, void_reason='s44 void test' WHERE id=v_oid;
  PERFORM void_order_rpc_v2(v_oid);  -- restaure stock + display (Wave D _017)
  SELECT quantity::int INTO v_q1 FROM display_stock WHERE product_id=current_setting('s44.disp')::uuid;
  SELECT count(*) INTO v_vm FROM display_movements WHERE reference_id=v_oid AND movement_type='sale_void';
  PERFORM set_config('s44.t8', (v_q1 = v_q0 + 1 AND v_vm = 1)::text, true);
END $$;
SELECT ok(current_setting('s44.t8')::boolean, 'T8 void restores display_stock + sale_void movement (Wave D)');

SELECT * FROM finish();
ROLLBACK;
