BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);
CREATE TEMP TABLE pos_audit_results (name text, passed boolean);
DO $test$
DECLARE
  actor uuid; profile uuid; session uuid := gen_random_uuid(); product uuid := gen_random_uuid();
  category uuid; payload jsonb; envelope jsonb; v_order_id uuid; key uuid := gen_random_uuid();
  nonce uuid := gen_random_uuid(); refused boolean := false; tablet_id uuid;
BEGIN
  SELECT auth_user_id, id INTO actor, profile FROM user_profiles
    WHERE deleted_at IS NULL AND has_permission(auth_user_id, 'pos.sale.create')
      AND has_permission(auth_user_id, 'sales.create') AND has_permission(auth_user_id, 'sales.discount') LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'Missing test actor'; END IF;
  PERFORM set_config('request.jwt.claim.sub', actor::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', actor)::text, true);
  SELECT id INTO category FROM categories WHERE deleted_at IS NULL LIMIT 1;
  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=profile, closing_cash=0
    WHERE opened_by=profile AND status='open';
  INSERT INTO pos_sessions(id, opened_by, opening_cash, status) VALUES(session, profile, 0, 'open');
  INSERT INTO products(id, sku, name, category_id, retail_price, product_type, track_inventory)
    VALUES(product, 'POS-AUDIT-' || left(product::text,8), 'Audit price fixture', category, 20000, 'finished', false);
  INSERT INTO product_modifiers(product_id, group_name, group_required, group_type, option_label, price_adjustment, is_active)
    VALUES(product, 'Milk', false, 'single_select', 'Oat', 3000, true);
  payload := jsonb_build_array(jsonb_build_object('client_line_id','local-coffee','product_id',product,
    'quantity',2,'unit_price',1,'modifiers', jsonb_build_array(jsonb_build_object(
      'group_name','Milk','option_label','Oat','price_adjustment',1))));
  envelope := fire_counter_order_v9(key,session,payload);
  v_order_id := (envelope->>'order_id')::uuid;
  INSERT INTO pos_audit_results VALUES
    ('counter prices simple products and modifiers on server', (SELECT line_total=46000 FROM order_items WHERE order_items.order_id=v_order_id)),
    ('response maps local and server identities', envelope->'items'->0->>'client_line_id'='local-coffee' AND envelope->'items'->0->>'id' IS NOT NULL),
    ('response contains business order number', envelope->>'order_number' IS NOT NULL);
  envelope := fire_counter_order_v9(key,session,payload);
  INSERT INTO pos_audit_results VALUES('replay preserves a single line', (SELECT count(*)=1 FROM order_items WHERE order_items.order_id=v_order_id));
  UPDATE order_items SET is_cancelled=true, cancelled_at=now(), cancelled_by=profile,
    cancelled_reason='Audit cancellation' WHERE order_items.order_id=v_order_id;
  envelope := get_pos_order_snapshot_v1(v_order_id);
  INSERT INTO pos_audit_results VALUES('snapshot retains cancellation facts', (envelope->'items'->0->>'is_cancelled')::boolean);
  payload := jsonb_set(payload, '{0,discount_amount}', '1000');
  BEGIN
    PERFORM fire_counter_order_v9(gen_random_uuid(),session,payload,p_discount_authorized_by:=profile);
  EXCEPTION WHEN SQLSTATE '42501' THEN refused := true; END;
  INSERT INTO pos_audit_results VALUES('manager identity alone cannot authorize a discount',refused);
  INSERT INTO discount_authorizations(id,manager_profile_id,scope,expires_at) VALUES(nonce,profile,'discount',now()+interval '5 minutes');
  envelope := fire_counter_order_v9(gen_random_uuid(),session,payload,p_discount_authorized_by:=profile,p_discount_auth_id:=nonce);
  INSERT INTO pos_audit_results VALUES('valid nonce is consumed and bound to order',
    (SELECT consumed_at IS NOT NULL AND consumed_order_id=(envelope->>'order_id')::uuid FROM discount_authorizations WHERE id=nonce));
  refused := false;
  BEGIN
    PERFORM fire_counter_order_v9(gen_random_uuid(),session,payload,p_discount_authorized_by:=profile,p_discount_auth_id:=nonce);
  EXCEPTION WHEN SQLSTATE '42501' THEN refused := true; END;
  INSERT INTO pos_audit_results VALUES('a nonce cannot authorize another fire', refused);
  envelope := fire_counter_order_v9(gen_random_uuid(),session,payload,p_discount_authorized_by:=profile,p_tolerate_unsellable:=true,p_offline_replay:=true);
  INSERT INTO pos_audit_results VALUES('legacy offline discounted sale remains replayable', envelope->>'order_id' IS NOT NULL);
  tablet_id := create_tablet_order_v10(gen_random_uuid(),profile,'','take_out',payload);
  INSERT INTO pos_audit_results VALUES('tablet resolves the same canonical simple price',
    (SELECT line_total=46000 FROM order_items WHERE order_items.order_id=tablet_id));
END;
$test$;
SELECT ok(passed,name) FROM pos_audit_results;
SELECT * FROM finish();
ROLLBACK;
