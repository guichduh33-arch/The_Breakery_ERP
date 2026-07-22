-- supabase/tests/canonical_line_price.test.sql
-- Session 51 / W1 — tests d'acceptation A1-A4 pour la resolution canonique du prix de ligne.
--   A1 : _resolve_line_price_v1 unit_price = retail_price serveur (ignore client) + line_subtotal
--   A2 : modificateur actif -> price_adjustment serveur (ignore client) dans total + modifiers_resolved
--   A3 : modificateur inconnu/inactif -> check_violation (23514)
--   A4 : ligne cadeau (is_gift=true) -> unit_price=0, modifiers_total=0
--   T9 : anon EXECUTE revoque sur complete_order_with_payment_v19
--   T10-12 : smoke v15 — total + lines[] refletent le prix serveur (ignore unit_price client)
--   T13 : v14 droppee
--
-- Pattern fixtures : s44_money_gates (resolution dynamique du cashier + produit reel).
-- Executer via MCP execute_sql (BEGIN..ROLLBACK).

BEGIN;

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_p1 UUID; v_p3 UUID;
BEGIN
  -- Cashier reel avec pos.sale.create (jamais hardcode).
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no user_profiles row with pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  -- Session ouverte pour ce cashier.
  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  -- P1 : produit reel non-combo, non-display, track_inventory ; retail epingle a 15000.
  SELECT id INTO v_p1 FROM products
    WHERE deleted_at IS NULL AND parent_product_id IS NULL AND is_active = true
      AND COALESCE(product_type::text, '') <> 'combo'
    ORDER BY id LIMIT 1;
  IF v_p1 IS NULL THEN RAISE EXCEPTION 'fixture: no eligible product for P1'; END IF;
  UPDATE products SET is_display_item=false, track_inventory=true, current_stock=1000, retail_price=15000 WHERE id=v_p1;

  -- P3 : second produit distinct (test cadeau, retail 10000).
  SELECT id INTO v_p3 FROM products
    WHERE deleted_at IS NULL AND parent_product_id IS NULL AND is_active = true
      AND id <> v_p1 AND COALESCE(product_type::text, '') <> 'combo'
    ORDER BY id LIMIT 1;
  IF v_p3 IS NULL THEN RAISE EXCEPTION 'fixture: no eligible product for P3'; END IF;
  UPDATE products SET retail_price=10000 WHERE id=v_p3;

  -- Modificateur scope-produit pour P1 : Size/Large=5000 actif ; Size/InactiveOpt inactif.
  DELETE FROM product_modifiers WHERE product_id=v_p1 AND group_name='Size' AND option_label IN ('Large','InactiveOpt');
  INSERT INTO product_modifiers (product_id, category_id, group_name, option_label, price_adjustment, is_active)
    VALUES (v_p1, NULL, 'Size', 'Large', 5000, true),
           (v_p1, NULL, 'Size', 'InactiveOpt', 3000, false);

  PERFORM set_config('w1.p1',   v_p1::text,   true);
  PERFORM set_config('w1.p3',   v_p3::text,   true);
  PERFORM set_config('w1.sess', v_sess::text, true);
END $$;

-- Smoke v15 : 2 x P1 (retail 15000) avec unit_price client falsifie a 99999.
DO $$
DECLARE r JSONB;
BEGIN
  r := complete_order_with_payment_v19(
    p_session_id := current_setting('w1.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items      := jsonb_build_array(jsonb_build_object(
                      'product_id', current_setting('w1.p1')::uuid,
                      'quantity', 2, 'unit_price', 99999, 'modifiers', '[]'::jsonb)),
    p_payment    := jsonb_build_object('method','cash','amount',30000,'cash_received',30000,'change_given',0));
  PERFORM set_config('w1.smoke_total', r->>'total', true);
  PERFORM set_config('w1.smoke_lines', r->>'lines', true);
END $$;

SELECT plan(13);

-- A1
SELECT is(
  (SELECT (lp).unit_price FROM _resolve_line_price_v1(current_setting('w1.p1')::uuid, 1, '[]'::jsonb, NULL, false, false) lp),
  15000::numeric, 'T1 A1 - unit_price = retail_price (15000), client ignore');

SELECT is(
  (SELECT (lp).line_subtotal FROM _resolve_line_price_v1(current_setting('w1.p1')::uuid, 3, '[]'::jsonb, NULL, false, false) lp),
  45000::numeric, 'T2 A1 - line_subtotal = 15000*3 = 45000');

-- A2
SELECT is(
  (SELECT (lp).modifiers_total FROM _resolve_line_price_v1(current_setting('w1.p1')::uuid, 1,
    '[{"group_name":"Size","option_label":"Large","price_adjustment":9999}]'::jsonb, NULL, false, false) lp),
  5000::numeric, 'T3 A2 - modifiers_total = serveur 5000 (client 9999 ignore)');

SELECT is(
  (SELECT (lp).line_subtotal FROM _resolve_line_price_v1(current_setting('w1.p1')::uuid, 2,
    '[{"group_name":"Size","option_label":"Large","price_adjustment":0}]'::jsonb, NULL, false, false) lp),
  40000::numeric, 'T4 A2 - line_subtotal = (15000+5000)*2 = 40000');

SELECT is(
  (SELECT ((lp).modifiers_resolved->0->>'price_adjustment')::numeric FROM _resolve_line_price_v1(current_setting('w1.p1')::uuid, 1,
    '[{"group_name":"Size","option_label":"Large","price_adjustment":0}]'::jsonb, NULL, false, false) lp),
  5000::numeric, 'T5 A2 - modifiers_resolved[0].price_adjustment = serveur 5000');

-- A3
SELECT throws_ok(
  $q$ SELECT * FROM _resolve_line_price_v1((SELECT current_setting('w1.p1'))::uuid, 1,
    '[{"group_name":"Size","option_label":"UnknownOpt","price_adjustment":0}]'::jsonb, NULL, false, false) $q$,
  '23514', NULL, 'T6 A3 - modificateur inconnu -> check_violation');

SELECT throws_ok(
  $q$ SELECT * FROM _resolve_line_price_v1((SELECT current_setting('w1.p1'))::uuid, 1,
    '[{"group_name":"Size","option_label":"InactiveOpt","price_adjustment":0}]'::jsonb, NULL, false, false) $q$,
  '23514', NULL, 'T7 A3 - modificateur inactif -> check_violation');

-- A4
SELECT ok(
  (SELECT (lp).unit_price = 0 AND (lp).modifiers_total = 0
     FROM _resolve_line_price_v1(current_setting('w1.p3')::uuid, 1, '[]'::jsonb, NULL, true, false) lp),
  'T8 A4 - ligne cadeau -> unit_price=0, modifiers_total=0');

-- Gate anon
SELECT ok(
  NOT has_function_privilege('anon',
    'complete_order_with_payment_v19(uuid,order_type,jsonb,jsonb,uuid,uuid,integer,text,numeric,text,numeric,text,uuid,jsonb,jsonb,uuid)',
    'EXECUTE'),
  'T9 anon EXECUTE revoque sur v17');

-- Smoke v15
SELECT is(current_setting('w1.smoke_total')::numeric, 30000::numeric,
  'T10 smoke v15 - total = prix serveur (2*15000=30000), client 99999 ignore');

SELECT is((current_setting('w1.smoke_lines')::jsonb->0->>'unit_price')::numeric, 15000::numeric,
  'T11 smoke v15 - lines[0].unit_price = retail serveur (15000)');

SELECT is((current_setting('w1.smoke_lines')::jsonb->0->>'line_subtotal')::numeric, 30000::numeric,
  'T12 smoke v15 - lines[0].line_subtotal = 15000*2 = 30000');

-- Version
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='complete_order_with_payment_v14'),
  'T13 v14 droppee apres migration v15');

SELECT * FROM finish();
ROLLBACK;
