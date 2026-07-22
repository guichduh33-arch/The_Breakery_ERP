-- supabase/tests/complete_order_v19_sellability_guard.test.sql
-- ADR-011 déc. 2 — gardes vendabilité de complete_order_with_payment_v19 :
--   T1 : produit is_active=false  → refus 'product_inactive'
--   T2 : produit-PARENT (variantes actives) → refus 'product_is_parent'
--   T3 : produit soft-deleted → 'Product not found'
--   T4 : variante ACTIVE d'un parent → vente OK (la garde ne sur-bloque pas)
--   T5 : standalone actif → vente OK (happy path intact)
-- Harnais s44 (jwt-claims + fixtures rollback). Exécuter via MCP execute_sql
-- ou runner API (BEGIN..ROLLBACK inclus).
BEGIN;
SELECT plan(5);

DO $$
DECLARE v_auth UUID; v_prof UUID; v_sess UUID;
        v_inactive UUID; v_parent UUID; v_variant UUID; v_deleted UUID; v_ok UUID;
        v_cat_id UUID;
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

  SELECT category_id INTO v_cat_id FROM products WHERE deleted_at IS NULL LIMIT 1;

  -- Fixtures dédiées (rollback) : 5 produits neufs, aucun risque de collision fixture.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('V19G-INACT', 'v19 guard inactive', v_cat_id, 10000, 100, 'pcs', 1, 'finished', false, false, false)
    RETURNING id INTO v_inactive;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('V19G-PARENT', 'v19 guard parent', v_cat_id, 10000, 100, 'pcs', 1, 'finished', true, false, false)
    RETURNING id INTO v_parent;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, track_inventory, is_display_item,
                        parent_product_id, variant_label, variant_axis)
    VALUES ('V19G-VAR', 'v19 guard variant', v_cat_id, 12000, 100, 'pcs', 1, 'finished', true, false, false,
            v_parent, 'Guard', 'flavor')
    RETURNING id INTO v_variant;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, track_inventory, is_display_item, deleted_at)
    VALUES ('V19G-DEL', 'v19 guard deleted', v_cat_id, 10000, 100, 'pcs', 1, 'finished', true, false, false, now())
    RETURNING id INTO v_deleted;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('V19G-OK', 'v19 guard ok', v_cat_id, 10000, 100, 'pcs', 1, 'finished', true, false, false)
    RETURNING id INTO v_ok;

  PERFORM set_config('v19g.sess', v_sess::text, true);
  PERFORM set_config('v19g.inactive', v_inactive::text, true);
  PERFORM set_config('v19g.parent', v_parent::text, true);
  PERFORM set_config('v19g.variant', v_variant::text, true);
  PERFORM set_config('v19g.deleted', v_deleted::text, true);
  PERFORM set_config('v19g.ok', v_ok::text, true);
END $$;

-- T1 : produit inactif → product_inactive.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM complete_order_with_payment_v19(
      p_session_id := current_setting('v19g.sess')::uuid, p_order_type := 'take_out',
      p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('v19g.inactive')::uuid, 'quantity', 1, 'unit_price', 10000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('v19g.t1', (v_msg ILIKE '%product_inactive%')::text, true);
END $$;
SELECT ok(current_setting('v19g.t1')::boolean, 'T1 inactive product refused (product_inactive)');

-- T2 : produit-parent → product_is_parent.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM complete_order_with_payment_v19(
      p_session_id := current_setting('v19g.sess')::uuid, p_order_type := 'take_out',
      p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('v19g.parent')::uuid, 'quantity', 1, 'unit_price', 10000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('v19g.t2', (v_msg ILIKE '%product_is_parent%')::text, true);
END $$;
SELECT ok(current_setting('v19g.t2')::boolean, 'T2 parent product refused (product_is_parent)');

-- T3 : produit soft-deleted → Product not found.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM complete_order_with_payment_v19(
      p_session_id := current_setting('v19g.sess')::uuid, p_order_type := 'take_out',
      p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('v19g.deleted')::uuid, 'quantity', 1, 'unit_price', 10000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('v19g.t3', (v_msg ILIKE '%Product not found%')::text, true);
END $$;
SELECT ok(current_setting('v19g.t3')::boolean, 'T3 soft-deleted product treated as not found');

-- T4 : variante active d'un parent → vente OK.
DO $$ DECLARE v_env JSONB;
BEGIN
  v_env := complete_order_with_payment_v19(
    p_session_id := current_setting('v19g.sess')::uuid, p_order_type := 'take_out',
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('v19g.variant')::uuid, 'quantity', 1, 'unit_price', 12000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',12000,'cash_received',12000,'change_given',0));
  PERFORM set_config('v19g.t4', ((SELECT status FROM orders WHERE id=(v_env->>'order_id')::uuid)='paid')::text, true);
END $$;
SELECT ok(current_setting('v19g.t4')::boolean, 'T4 active variant sells fine');

-- T5 : standalone actif → vente OK (happy path intact).
DO $$ DECLARE v_env JSONB;
BEGIN
  v_env := complete_order_with_payment_v19(
    p_session_id := current_setting('v19g.sess')::uuid, p_order_type := 'take_out',
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('v19g.ok')::uuid, 'quantity', 1, 'unit_price', 10000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0));
  PERFORM set_config('v19g.t5', ((SELECT status FROM orders WHERE id=(v_env->>'order_id')::uuid)='paid')::text, true);
END $$;
SELECT ok(current_setting('v19g.t5')::boolean, 'T5 active standalone sells fine');

SELECT * FROM finish();
ROLLBACK;
