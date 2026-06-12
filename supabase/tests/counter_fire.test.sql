-- supabase/tests/counter_fire.test.sql
-- S43 Wave C (P0-3) — fire_counter_order_v1 : create / replay / append / P0002 / anon revoke.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK). Pattern jwt-claims S37 (order_discount_gate) :
-- caller = un VRAI user_profiles avec pos.sale.create, auth.uid() simulé via request.jwt.claims.
BEGIN;
SELECT plan(8);

-- Fixture : caller authentifié + session POS open + produit seed (BEV-AMER canonique, cf. Stock Audit _020).
DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_prod UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'fixture: no user_profiles row with pos.sale.create';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  -- Session open existante, sinon fixture in-transaction (rollback).
  SELECT id INTO v_sess FROM pos_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status)
      VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  SELECT id INTO v_prod FROM products WHERE sku = 'BEV-AMER' AND deleted_at IS NULL LIMIT 1;
  IF v_prod IS NULL THEN
    SELECT id INTO v_prod FROM products
     WHERE deleted_at IS NULL AND is_active = true AND parent_product_id IS NULL
     LIMIT 1;
  END IF;

  CREATE TEMP TABLE _fx AS SELECT v_sess AS session_id, v_prod AS product_id;
END $$;

-- T1 : create — un fire crée un ordre pending_payment created_via='pos' avec items locked.
SELECT lives_ok($$
  SELECT fire_counter_order_v1(
    '11111111-1111-1111-1111-111111111111'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    NULL, 'T-03')
$$, 'T1: fire create succeeds');

-- T2 : l'ordre existe avec le bon shape.
SELECT is(
  (SELECT count(*)::int FROM orders o
    JOIN counter_fire_idempotency_keys k ON k.order_id = o.id
    WHERE k.client_uuid = '11111111-1111-1111-1111-111111111111'
      AND o.created_via = 'pos' AND o.status = 'pending_payment' AND o.table_number = 'T-03'
      AND o.session_id = (SELECT session_id FROM _fx) AND o.sent_to_kitchen_at IS NOT NULL),
  1, 'T2: order row pending_payment/pos/T-03');

-- T3 : item locked + kitchen pending + sent.
SELECT is(
  (SELECT count(*)::int FROM order_items oi
    JOIN counter_fire_idempotency_keys k ON k.order_id = oi.order_id
    WHERE k.client_uuid = '11111111-1111-1111-1111-111111111111'
      AND oi.is_locked AND oi.kitchen_status = 'pending' AND oi.sent_to_kitchen_at IS NOT NULL),
  1, 'T3: order_item locked/pending/sent');

-- T4 : replay même client_uuid → même ordre, flag idempotent_replay, pas de doublon.
SELECT is(
  ((SELECT fire_counter_order_v1(
    '11111111-1111-1111-1111-111111111111'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    NULL, 'T-03'))->>'idempotent_replay'),
  'true', 'T4: replay flagged, no duplicate order');

-- T5 : append (nouveau client_uuid, p_order_id du fire T1) ajoute un item au même ordre.
SELECT lives_ok($$
  SELECT fire_counter_order_v1(
    '22222222-2222-2222-2222-222222222222'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 2, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    (SELECT order_id FROM counter_fire_idempotency_keys WHERE client_uuid = '11111111-1111-1111-1111-111111111111'),
    'T-03')
$$, 'T5: append succeeds');
SELECT is(
  (SELECT count(*)::int FROM order_items oi
    JOIN counter_fire_idempotency_keys k ON k.order_id = oi.order_id
    WHERE k.client_uuid = '11111111-1111-1111-1111-111111111111'),
  2, 'T5b: order now has 2 items');

-- T6 : produit inconnu = erreur franche P0002 (pas de silent skip, DEV-S25-1.A-03).
SELECT throws_ok($$
  SELECT fire_counter_order_v1(
    '33333333-3333-3333-3333-333333333333'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', '99999999-9999-9999-9999-999999999999', 'quantity', 1, 'unit_price', 1000, 'modifiers', '[]'::jsonb)))
$$, 'P0002', NULL, 'T6: unknown product raises P0002');

-- T7 : anon n'a pas EXECUTE (REVOKE pair canonique S25).
SELECT is(
  has_function_privilege('anon', 'public.fire_counter_order_v1(uuid,uuid,jsonb,uuid,text,order_type)', 'EXECUTE'),
  false, 'T7: anon revoked');

SELECT * FROM finish();
ROLLBACK;
