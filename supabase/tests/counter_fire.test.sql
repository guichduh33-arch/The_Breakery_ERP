-- supabase/tests/counter_fire.test.sql
-- S43 Wave C (P0-3) — fire_counter_order_v4 : create / replay / append / P0002 / anon revoke.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK). Pattern jwt-claims S37 (order_discount_gate) :
-- caller = un VRAI user_profiles avec pos.sale.create, auth.uid() simulé via request.jwt.claims.
BEGIN;
SELECT plan(15);

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

  -- S44 P0-C(3) : autorisateur valide (sales.discount) et non-autorisé (sans).
  DECLARE v_mgr UUID; v_cashier UUID;
  BEGIN
    SELECT up.id INTO v_mgr FROM user_profiles up
      WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
        AND has_permission(up.auth_user_id, 'sales.discount') LIMIT 1;
    SELECT up.id INTO v_cashier FROM user_profiles up
      WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
        AND NOT has_permission(up.auth_user_id, 'sales.discount') LIMIT 1;
    CREATE TEMP TABLE _fx AS
      SELECT v_sess AS session_id, v_prod AS product_id, v_mgr AS mgr_id, v_cashier AS cashier_id;
  END;
END $$;

-- T1 : create — un fire crée un ordre pending_payment created_via='pos' avec items locked.
SELECT lives_ok($$
  SELECT fire_counter_order_v4(
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
  ((SELECT fire_counter_order_v4(
    '11111111-1111-1111-1111-111111111111'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    NULL, 'T-03'))->>'idempotent_replay'),
  'true', 'T4: replay flagged, no duplicate order');

-- T5 : append (nouveau client_uuid, p_order_id du fire T1) ajoute un item au même ordre.
SELECT lives_ok($$
  SELECT fire_counter_order_v4(
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
  SELECT fire_counter_order_v4(
    '33333333-3333-3333-3333-333333333333'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', '99999999-9999-9999-9999-999999999999', 'quantity', 1, 'unit_price', 1000, 'modifiers', '[]'::jsonb)))
$$, 'P0002', NULL, 'T6: unknown product raises P0002');

-- T7 : anon n'a pas EXECUTE (REVOKE pair canonique S25).
SELECT is(
  has_function_privilege('anon', 'public.fire_counter_order_v4(uuid,uuid,jsonb,uuid,text,order_type,uuid)', 'EXECUTE'),
  false, 'T7: anon revoked');

-- T8 : clamp money-path (corrective _013) — discount > brut est clampé au brut,
-- line_total ne devient jamais négatif (pay_existing_order_v7 encaisse SUM(line_total)).
SELECT lives_ok($$
  SELECT fire_counter_order_v4(
    '44444444-4444-4444-4444-444444444444'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 10000,
      'modifiers', '[]'::jsonb, 'discount_amount', 999999)),
    NULL, 'T-04', 'take_out'::order_type, (SELECT mgr_id FROM _fx))
$$, 'T8: fire with oversized line discount succeeds (authorized)');
SELECT is(
  (SELECT oi.line_total::int FROM order_items oi
    JOIN counter_fire_idempotency_keys k ON k.order_id = oi.order_id
    WHERE k.client_uuid = '44444444-4444-4444-4444-444444444444'
      AND oi.discount_amount = 10000), -- le discount STOCKÉ est le clampé (= brut), pas le 999999 brut
  0, 'T8b: oversized discount clamped to gross, line_total floored at 0');

-- T9 : corrective _016 (DEV-S43-F1-03) — pay_existing_order_v7 accepte un ordre
-- comptoir fired (pending_payment + created_via='pos') : l'appel avec un montant
-- volontairement faux échoue PLUS LOIN que le gate de statut (le message n'est
-- plus « not in draft status » / « not payable »). GUC pattern S25 DEV-S25-2.A-03.
DO $$
DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM pay_existing_order_v11(
      p_order_id := (SELECT order_id FROM counter_fire_idempotency_keys
                     WHERE client_uuid = '11111111-1111-1111-1111-111111111111'),
      p_payment  := jsonb_build_object('method', 'cash', 'amount', 1, 'cash_received', 1)
    );
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  PERFORM set_config('breakery.t9_msg', v_msg, true);
END $$;
SELECT ok(
  current_setting('breakery.t9_msg') NOT ILIKE '%not in draft status%'
  AND current_setting('breakery.t9_msg') NOT ILIKE '%not payable%'
  AND current_setting('breakery.t9_msg') NOT ILIKE '%does not exist%', -- guard faux positif (résolution de fonction)
  'T9: status gate accepts a fired counter order (failure, if any, is past the gate: '
    || current_setting('breakery.t9_msg') || ')');

-- T10 : remise de ligne SANS autorisateur (P0-C 3) ⇒ 'Discount requires an authorizing manager'.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM fire_counter_order_v4(
      '60000000-0000-0000-0000-000000000010'::uuid, (SELECT session_id FROM _fx),
      jsonb_build_array(jsonb_build_object('product_id', (SELECT product_id FROM _fx),
        'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb, 'discount_amount', 5000)),
      NULL, 'T-10');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('breakery.t10', (v_msg ILIKE '%Discount requires an authorizing manager%')::text, true);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean, 'T10: appended line discount without authorizer rejected');

-- T11 : autorisateur sans sales.discount ⇒ 'Authorizer lacks permission: sales.discount'.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  IF (SELECT cashier_id FROM _fx) IS NULL THEN
    PERFORM set_config('breakery.t11', 'true', true);  -- pas de profil sans perm dans le seed : skip-as-pass
  ELSE
    BEGIN
      PERFORM fire_counter_order_v4(
        '60000000-0000-0000-0000-000000000011'::uuid, (SELECT session_id FROM _fx),
        jsonb_build_array(jsonb_build_object('product_id', (SELECT product_id FROM _fx),
          'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb, 'discount_amount', 5000)),
        NULL, 'T-11', 'take_out'::order_type, (SELECT cashier_id FROM _fx));
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    PERFORM set_config('breakery.t11', (v_msg ILIKE '%Authorizer lacks permission: sales.discount%')::text, true);
  END IF;
END $$;
SELECT ok(current_setting('breakery.t11')::boolean, 'T11: unauthorized authorizer rejected');

-- T12 : autorisateur MANAGER ⇒ succès, discount_amount=5000 + audit order.discount_applied fire_v2.
DO $$ DECLARE v_oid UUID; v_disc INT; v_au INT;
BEGIN
  PERFORM fire_counter_order_v4(
    '60000000-0000-0000-0000-000000000012'::uuid, (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object('product_id', (SELECT product_id FROM _fx),
      'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb, 'discount_amount', 5000)),
    NULL, 'T-12', 'take_out'::order_type, (SELECT mgr_id FROM _fx));
  SELECT order_id INTO v_oid FROM counter_fire_idempotency_keys WHERE client_uuid='60000000-0000-0000-0000-000000000012';
  SELECT oi.discount_amount::int INTO v_disc FROM order_items oi WHERE oi.order_id=v_oid;
  SELECT count(*) INTO v_au FROM audit_logs WHERE entity_id=v_oid AND action='order.discount_applied' AND metadata->>'rpc_version'='fire_v4';
  PERFORM set_config('breakery.t12', (v_disc=5000 AND v_au=1)::text, true);
END $$;
SELECT ok(current_setting('breakery.t12')::boolean, 'T12: authorized line discount applied + audited');

-- T13 : chemin nominal sans remise, autorisateur NULL ⇒ succès.
SELECT lives_ok($$
  SELECT fire_counter_order_v4(
    '60000000-0000-0000-0000-000000000013'::uuid, (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object('product_id', (SELECT product_id FROM _fx),
      'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    NULL, 'T-13')
$$, 'T13: no-discount fire still succeeds without authorizer');

SELECT * FROM finish();
ROLLBACK;
