-- supabase/tests/complete_order_v27_table_guard.test.sql
-- Fiche02-D2.5 — table OBLIGATOIRE en dine-in : le checkout direct
-- (EF process-payment → complete_order_with_payment) était la dernière porte de
-- création sans filet serveur (fire_counter_order et create_tablet_order gardent
-- depuis _122/_144). v27 = v26 + garde P0011, placée APRÈS le replay
-- d'idempotence (un replay legacy sans table reste servi — même design que
-- fire_counter_order).
--   T1 : dine_in + table NULL    → P0011 table_required_for_dine_in
--   T2 : dine_in + table blanche → P0011 (btrim)
--   T3 : dine_in + table valide  → vente OK, table_number persisté
--   T4 : take_out sans table     → vente OK (la garde ne sur-bloque pas)
--   T5 : replay idempotent d'une commande existante avec table NULL → servi
--        (le court-circuit précède la garde)
--   T6 : v26 droppée, v27 seule vivante (versionnage monotone)
-- Harnais s44 (jwt-claims + fixtures rollback). Exécuter via MCP execute_sql
-- (BEGIN..ROLLBACK inclus).
BEGIN;
SELECT plan(6);

DO $$
DECLARE v_auth UUID; v_prof UUID; v_sess UUID; v_prod UUID; v_cat_id UUID;
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
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('V27G-OK', 'v27 table guard', v_cat_id, 10000, 100, 'pcs', 1, 'finished', true, false, false)
    RETURNING id INTO v_prod;

  PERFORM set_config('v27g.sess', v_sess::text, true);
  PERFORM set_config('v27g.items',
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 10000, 'modifiers', '[]'::jsonb))::text,
    true);
END $$;

-- T1 : dine_in + table NULL → P0011.
SELECT throws_ok(
  format($q$ SELECT complete_order_with_payment_v27(
      p_session_id := %L::uuid, p_order_type := 'dine_in',
      p_items := %L::jsonb,
      p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0)) $q$,
    current_setting('v27g.sess'), current_setting('v27g.items')),
  'P0011', 'table_required_for_dine_in',
  'T1: dine_in + table NULL -> P0011 table_required_for_dine_in');

-- T2 : dine_in + table blanche (espaces) → P0011.
SELECT throws_ok(
  format($q$ SELECT complete_order_with_payment_v27(
      p_session_id := %L::uuid, p_order_type := 'dine_in',
      p_items := %L::jsonb,
      p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0),
      p_table_number := '   ') $q$,
    current_setting('v27g.sess'), current_setting('v27g.items')),
  'P0011', 'table_required_for_dine_in',
  'T2: dine_in + table blanche -> P0011 (btrim)');

-- T3 : dine_in + table valide → vente OK, table_number persisté.
DO $$ DECLARE v_env JSONB;
BEGIN
  v_env := complete_order_with_payment_v27(
    p_session_id := current_setting('v27g.sess')::uuid, p_order_type := 'dine_in',
    p_items := current_setting('v27g.items')::jsonb,
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0),
    p_table_number := 'T1');
  PERFORM set_config('v27g.t3',
    ((SELECT status = 'paid' AND table_number = 'T1' FROM orders WHERE id=(v_env->>'order_id')::uuid))::text, true);
END $$;
SELECT ok(current_setting('v27g.t3')::boolean, 'T3: dine_in + table valide -> vente OK, table persistee');

-- T4 : take_out sans table → vente OK.
DO $$ DECLARE v_env JSONB;
BEGIN
  v_env := complete_order_with_payment_v27(
    p_session_id := current_setting('v27g.sess')::uuid, p_order_type := 'take_out',
    p_items := current_setting('v27g.items')::jsonb,
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0));
  PERFORM set_config('v27g.t4',
    ((SELECT status FROM orders WHERE id=(v_env->>'order_id')::uuid)='paid')::text, true);
END $$;
SELECT ok(current_setting('v27g.t4')::boolean, 'T4: take_out sans table -> vente OK');

-- T5 : replay idempotent — la clé d'une commande existante court-circuite AVANT
-- la garde : re-appel dine_in SANS table, même clé → enveloppe replay, pas P0011.
DO $$ DECLARE v_key UUID := gen_random_uuid(); v_env JSONB; v_replay JSONB;
BEGIN
  v_env := complete_order_with_payment_v27(
    p_session_id := current_setting('v27g.sess')::uuid, p_order_type := 'dine_in',
    p_items := current_setting('v27g.items')::jsonb,
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0),
    p_idempotency_key := v_key, p_table_number := 'T2');
  v_replay := complete_order_with_payment_v27(
    p_session_id := current_setting('v27g.sess')::uuid, p_order_type := 'dine_in',
    p_items := current_setting('v27g.items')::jsonb,
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000,'change_given',0),
    p_idempotency_key := v_key);
  PERFORM set_config('v27g.t5',
    ((v_replay->>'idempotent_replay')::boolean
      AND v_replay->>'order_id' = v_env->>'order_id')::text, true);
END $$;
SELECT ok(current_setting('v27g.t5')::boolean, 'T5: replay idempotent sans table -> servi (court-circuit avant la garde)');

-- T6 : versionnage monotone — v26 droppée, v27 vivante.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = 'complete_order_with_payment_v26'),
  0, 'T6: complete_order_with_payment_v26 est droppee');

SELECT * FROM finish();
ROLLBACK;
