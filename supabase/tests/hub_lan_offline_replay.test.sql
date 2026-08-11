-- supabase/tests/hub_lan_offline_replay.test.sql
-- Spec 006x lot 5 — chaos « double replay » côté serveur (§7.5) : rejouer
-- fire_counter_order_v6 / pay_existing_order_v17 avec les clés d'idempotence
-- D'ORIGINE est un no-op strict (une seule commande, un seul encaissement),
-- l'encaissement différé est accepté même rejoué (A4) et tracé
-- offline_replay:true dans audit_logs. Fixture jwt-claims pattern
-- counter_fire.test.sql.
-- ADR-015 (spec 015x lot 4) — T11/T12 : le hors-ligne n'est plus cash-only,
-- un SPLIT non-cash rejoué via p_payments écrit bien ses n lignes.
--
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK (ou API-from-file).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

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

  -- ADR-022 dec. 1 : la garde de vendabilite est active sur cette RPC, le fixture doit choisir un produit vendable de facon deterministe.
  SELECT p.id INTO v_prod FROM products p
   WHERE p.sku = 'BEV-AMER'
     AND p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.is_active = true
     AND p.product_type <> 'combo'
     AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id AND c.is_active AND c.deleted_at IS NULL)
   LIMIT 1;
  IF v_prod IS NULL THEN
    SELECT p.id INTO v_prod FROM products p
     WHERE p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.is_active = true
       AND p.product_type <> 'combo'
       AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id AND c.is_active AND c.deleted_at IS NULL)
     LIMIT 1;
  END IF;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'fixture: aucun produit vendable'; END IF;

  CREATE TEMP TABLE _fx AS
    SELECT v_sess AS session_id, v_prod AS product_id, NULL::uuid AS order_id;
END $$;

-- T1 : le fire offline rejoué (client_uuid d'origine) crée la commande.
SELECT lives_ok($$
  SELECT fire_counter_order_v6(
    '5a000000-0000-4000-8000-000000000001'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)))
$$, 'T1: offline fire replay creates the order');

UPDATE _fx SET order_id = (SELECT k.order_id FROM counter_fire_idempotency_keys k
  WHERE k.client_uuid = '5a000000-0000-4000-8000-000000000001');

-- T2 : cash différé rejoué (A4) — v16 accepte avec p_offline_replay. Montant =
-- SUM(line_total) : orders.total vaut encore 0 au fire (recalcul au paiement).
SELECT lives_ok($$
  SELECT pay_existing_order_v17(
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
  ((SELECT pay_existing_order_v17(
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
  ((SELECT fire_counter_order_v6(
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

-- T9 : anon n'a pas EXECUTE (REVOKE pair). Signature 14 args depuis v14
-- (D9 : + p_discount_auth_id) — était périmée (13 args).
SELECT is(
  has_function_privilege('anon',
    'public.pay_existing_order_v17(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean)',
    'EXECUTE'),
  false, 'T9: anon revoked on pay_existing_order_v17');

-- T10 (ADR-013 Lot 4, D8) : le replay offline ne bypasse PAS le gate avoir —
-- un tender store_credit sans client rattaché est refusé même avec
-- p_offline_replay=true (contrairement au bypass stock/nonce remise).
DO $$
DECLARE v_ord UUID;
BEGIN
  v_ord := (SELECT (fire_counter_order_v6(
    '5a000000-0000-4000-8000-000000000003'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb))))->>'order_id')::uuid;
  PERFORM set_config('hlr.order_sc', v_ord::text, true);
END $$;
SELECT throws_ok($$
  SELECT pay_existing_order_v17(
    p_order_id := current_setting('hlr.order_sc')::uuid,
    p_payment := (SELECT jsonb_build_object('method', 'store_credit', 'amount', s.amt)
      FROM (SELECT SUM(oi.line_total) AS amt FROM order_items oi
             WHERE oi.order_id = current_setting('hlr.order_sc')::uuid) s),
    p_idempotency_key := '5b000000-0000-4000-8000-000000000004'::uuid,
    p_offline_replay := true)
$$, 'P0015', NULL,
  'T10: offline replay does NOT bypass the D8 store-credit gate (P0015)');

-- T11-T12 (ADR-015, spec 015x lot 4) : le SPLIT hors-ligne rejoué. Deux
-- règlements NON-CASH (l'EDC carte et le QRIS encaissent par leur propre canal,
-- le POS ne fait qu'enregistrer) passent par p_payments avec p_offline_replay,
-- et produisent DEUX lignes order_payments — preuve d'exécution, là où la suite
-- settings ne prouvait que la présence du paramètre.
DO $$
DECLARE v_ord UUID;
BEGIN
  v_ord := (SELECT (fire_counter_order_v6(
    '5a000000-0000-4000-8000-000000000005'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 2, 'unit_price', 35000, 'modifiers', '[]'::jsonb))))->>'order_id')::uuid;
  PERFORM set_config('hlr.order_split', v_ord::text, true);
END $$;

SELECT lives_ok($$
  SELECT pay_existing_order_v17(
    p_order_id := current_setting('hlr.order_split')::uuid,
    p_payments := (SELECT jsonb_build_array(
        jsonb_build_object('method', 'card', 'amount', s.amt / 2),
        jsonb_build_object('method', 'qris', 'amount', s.amt - s.amt / 2))
      FROM (SELECT SUM(oi.line_total) AS amt FROM order_items oi
             WHERE oi.order_id = current_setting('hlr.order_split')::uuid) s),
    p_idempotency_key := '5b000000-0000-4000-8000-000000000006'::uuid,
    p_offline_replay := true)
$$, 'T11: offline replay accepts a two-tender non-cash split (p_payments)');

SELECT is(
  (SELECT count(*)::int FROM order_payments
    WHERE order_id = current_setting('hlr.order_split')::uuid),
  2, 'T12: the split replay writes exactly two order_payments rows');

SELECT * FROM finish();
ROLLBACK;
