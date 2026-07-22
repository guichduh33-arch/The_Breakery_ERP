-- supabase/tests/hub_lan_offline_replay.test.sql
-- Spec 006x lot 5 — chaos « double replay » côté serveur (§7.5) : rejouer
-- fire_counter_order_v4 / pay_existing_order_v13 avec les clés d'idempotence
-- D'ORIGINE est un no-op strict (une seule commande, un seul encaissement),
-- le cash différé est accepté même rejoué (A4) et tracé offline_replay:true
-- dans audit_logs. Fixture jwt-claims pattern counter_fire.test.sql.
--
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK (ou API-from-file).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

-- Fixture : caller avec pos.sale.create + payments.process, session open,
-- produit seed (BEV-AMER canonique, fallback premier produit actif).
DO $$
DECLARE v_auth UUID; v_prof UUID; v_sess UUID; v_prod UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
     AND has_permission(up.auth_user_id, 'payments.process')
   LIMIT 1;
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'fixture: no user with pos.sale.create + payments.process';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

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

  CREATE TEMP TABLE _fx AS
    SELECT v_sess AS session_id, v_prod AS product_id, NULL::uuid AS order_id;
END $$;

-- T1 : le fire offline rejoué (client_uuid d'origine) crée la commande.
SELECT lives_ok($$
  SELECT fire_counter_order_v4(
    '5a000000-0000-4000-8000-000000000001'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)))
$$, 'T1: offline fire replay creates the order');

UPDATE _fx SET order_id = (SELECT k.order_id FROM counter_fire_idempotency_keys k
  WHERE k.client_uuid = '5a000000-0000-4000-8000-000000000001');

-- T2 : cash différé rejoué (A4) — v13 accepte avec p_offline_replay. Montant =
-- SUM(line_total) : orders.total vaut encore 0 au fire (recalcul au paiement).
SELECT lives_ok($$
  SELECT pay_existing_order_v13(
    p_order_id := (SELECT order_id FROM _fx),
    p_payment := (SELECT jsonb_build_object(
        'method', 'cash', 'amount', s.amt, 'cash_received', s.amt, 'change_given', 0)
      FROM (SELECT SUM(oi.line_total) AS amt FROM order_items oi
             WHERE oi.order_id = (SELECT order_id FROM _fx)) s),
    p_idempotency_key := '5b000000-0000-4000-8000-000000000002'::uuid,
    p_offline_replay := true)
$$, 'T2: deferred cash replay accepted (A4)');

-- T3 : un seul encaissement enregistré.
SELECT is(
  (SELECT count(*)::int FROM order_payments WHERE order_id = (SELECT order_id FROM _fx)),
  1, 'T3: exactly one payment row');

-- T4 : A4 tracé — audit order.pay_existing porte offline_replay=true.
SELECT is(
  (SELECT count(*)::int FROM audit_logs
    WHERE entity_id = (SELECT order_id FROM _fx)
      AND action = 'order.pay_existing'
      AND metadata->>'offline_replay' = 'true'),
  1, 'T4: audit_logs marks offline_replay:true');

-- T5 : DOUBLE REPLAY paiement — même clé ⇒ enveloppe idempotent_replay, pas de 2e écriture.
SELECT is(
  ((SELECT pay_existing_order_v13(
    p_order_id := (SELECT order_id FROM _fx),
    p_payment := (SELECT jsonb_build_object(
        'method', 'cash', 'amount', s.amt, 'cash_received', s.amt, 'change_given', 0)
      FROM (SELECT SUM(oi.line_total) AS amt FROM order_items oi
             WHERE oi.order_id = (SELECT order_id FROM _fx)) s),
    p_idempotency_key := '5b000000-0000-4000-8000-000000000002'::uuid,
    p_offline_replay := true))->>'idempotent_replay'),
  'true', 'T5: double payment replay short-circuits as idempotent');

-- T6 : toujours un seul encaissement après le double replay.
SELECT is(
  (SELECT count(*)::int FROM order_payments WHERE order_id = (SELECT order_id FROM _fx)),
  1, 'T6: still exactly one payment row after double replay');

-- T7 : DOUBLE REPLAY fire — même client_uuid ⇒ idempotent_replay, même commande.
SELECT is(
  ((SELECT fire_counter_order_v4(
    '5a000000-0000-4000-8000-000000000001'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb))))->>'idempotent_replay'),
  'true', 'T7: double fire replay short-circuits as idempotent');

-- T8 : une seule commande pour la clé racine (pas de doublon au double replay).
SELECT is(
  (SELECT count(DISTINCT k.order_id)::int FROM counter_fire_idempotency_keys k
    WHERE k.client_uuid = '5a000000-0000-4000-8000-000000000001'),
  1, 'T8: a single order for the original fire key');

-- T9 : anon n'a pas EXECUTE sur v13 (REVOKE pair _198).
SELECT is(
  has_function_privilege('anon',
    'public.pay_existing_order_v13(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,jsonb,jsonb,boolean)',
    'EXECUTE'),
  false, 'T9: anon revoked on pay_existing_order_v13');

SELECT * FROM finish();
ROLLBACK;
