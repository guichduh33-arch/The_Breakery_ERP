-- supabase/tests/refund_number_rollover.test.sql
-- Fix 2026-07-27 (refund v9 / void v9) — le refund_number était généré par une
-- séquence JOURNALIÈRE sous une contrainte UNIQUE GLOBALE : le 1er refund d'un
-- nouveau jour collisionnait avec le R-0001 d'un jour antérieur, et le catch
-- unique_violation (idempotence D12) avalait la collision => no-op silencieux.
-- v9 : numéro daté R-YYMMDD-NNNN + catch qui RELANCE sans vraie clé retrouvée.
-- Run via API-from-file (BEGIN..ROLLBACK).

BEGIN;
SELECT plan(4);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_cat UUID; v_prod UUID; v_sess UUID;
  v_res JSONB; v_order1 UUID; v_order2 UUID; v_oi UUID; v_qty NUMERIC;
  v_seq INTEGER;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
     AND has_permission(up.auth_user_id, 'pos.sale.refund')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no manager-grade user found'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, track_inventory, is_display_item)
    VALUES ('TST-RNR', 'Rollover Product', v_cat, 20000, 1000, true, false)
    RETURNING id INTO v_prod;

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  -- Deux ventes cash de 20 000.
  v_res := complete_order_with_payment_v27(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',20000,'cash_received',20000));
  v_order1 := (v_res->>'order_id')::uuid;
  v_res := complete_order_with_payment_v27(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',20000,'cash_received',20000));
  v_order2 := (v_res->>'order_id')::uuid;

  -- Refund 1 (v9) : numéro attendu daté du jour.
  SELECT id, quantity INTO v_oi, v_qty FROM order_items WHERE order_id = v_order1 LIMIT 1;
  v_res := refund_order_rpc_v10(
    v_order1,
    jsonb_build_array(jsonb_build_object('order_item_id', v_oi, 'qty', v_qty)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 20000)),
    'rollover pgTAP refund 1', v_prof,
    '11111111-1111-1111-1111-111111111111'::uuid, v_auth);
  PERFORM set_config('rnr.num1', v_res->>'refund_number', true);
  PERFORM set_config('rnr.order1', v_order1::text, true);
  PERFORM set_config('rnr.oi1', v_oi::text, true);

  -- Sème une collision : occupe le PROCHAIN numéro du jour avec une ligne
  -- artificielle (droit postgres direct — simule le R-0001 historique d'hier).
  -- Rattachée à order1 (déjà intégralement remboursée) pour ne pas fausser le
  -- plafond global d'order2 ; total > 0 (CHECK refunds_total_check).
  SELECT last_number INTO v_seq FROM refund_sequences WHERE date = CURRENT_DATE;
  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
  VALUES ('R-' || to_char(CURRENT_DATE,'YYMMDD') || '-' || LPAD((v_seq + 1)::TEXT, 4, '0'),
          v_order1, v_sess, 1000, 0, 'rollover pgTAP seeded collision', v_prof, v_prof, false);

  PERFORM set_config('rnr.order2', v_order2::text, true);
  PERFORM set_config('rnr.prof',   v_prof::text,   true);
  PERFORM set_config('rnr.auth',   v_auth::text,   true);
  PERFORM set_config('rnr.oi2', (SELECT id::text FROM order_items WHERE order_id = v_order2 LIMIT 1), true);
END $$;

-- T1 : format daté R-YYMMDD-NNNN.
SELECT ok(
  current_setting('rnr.num1') LIKE 'R-' || to_char(CURRENT_DATE,'YYMMDD') || '-%',
  'T1: v9 refund_number is date-scoped (R-YYMMDD-NNNN)');

-- T2 : une collision de numéro SANS clé d''idempotence RELANCE l''erreur
-- (avant v9 : enveloppe replay vide, no-op silencieux).
SELECT throws_ok(
  format($sql$
    SELECT refund_order_rpc_v10(
      %L::uuid,
      jsonb_build_array(jsonb_build_object('order_item_id', %L::uuid, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 20000)),
      'rollover pgTAP collision', %L::uuid, NULL, %L::uuid)
  $sql$, current_setting('rnr.order2'), current_setting('rnr.oi2'),
         current_setting('rnr.prof'), current_setting('rnr.auth')),
  '23505', NULL,
  'T2: number collision without idempotency key re-raises (no silent no-op)');

-- T3 : le replay idempotent D12 marche toujours — même clé => enveloppe de la
-- 1ʳᵉ exécution avec idempotent_replay: true (pré-check, aucune nouvelle ligne).
SELECT is(
  (SELECT r->>'idempotent_replay' FROM refund_order_rpc_v10(
     current_setting('rnr.order1')::uuid,
     jsonb_build_array(jsonb_build_object('order_item_id', current_setting('rnr.oi1')::uuid, 'qty', 1)),
     jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 20000)),
     'rollover pgTAP replay', current_setting('rnr.prof')::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid,
     current_setting('rnr.auth')::uuid) AS r),
  'true', 'T3: idempotent replay (same key) still returns the first envelope');

-- T4 : v8 droppées, v9 seules, authenticated révoqué.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('refund_order_rpc_v8','void_order_rpc_v8')
                AND pronamespace = 'public'::regnamespace)
  AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refund_order_rpc_v10' AND pronamespace = 'public'::regnamespace)
  AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'void_order_rpc_v10' AND pronamespace = 'public'::regnamespace)
  AND NOT has_function_privilege('authenticated', 'public.refund_order_rpc_v10(uuid, jsonb, jsonb, text, uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.void_order_rpc_v10(uuid, text, uuid, uuid, uuid)', 'EXECUTE'),
  'T4: v8 dropped, v9 live, authenticated revoked (monotone versioning)');

SELECT * FROM finish();
ROLLBACK;
