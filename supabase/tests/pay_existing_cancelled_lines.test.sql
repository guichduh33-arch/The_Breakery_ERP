-- pay_existing_cancelled_lines.test.sql
-- Audit lot 1, P0 n°5 (2026-09-05) — lot C : pay_existing_order_v18 calcule le
-- total facture (v_items_total, SUM(line_total)) ET deduit le stock de vente
-- SANS filtrer is_cancelled = false. Une ligne annulee (cancel_order_item_rpc_v6,
-- ADR-010) reste donc facturee et deduite au paiement d'une commande deja
-- envoyee en cuisine (fire_counter_order_v7 -> toutes les lignes sont
-- is_locked = true). v19 filtre is_cancelled = false comme le fait deja
-- cancel_order_item_rpc_v6 pour orders.subtotal/tax/total (recalc correct a
-- l'annulation, incorrect au paiement).
--
-- Scenario : deux produits suivis (track_inventory=true, deduct_stock=true),
-- A (5000) et B (3000), stock initial 10 chacun. Fire dine-in des deux lignes
-- (qty 1) -> les deux lignes sont is_locked=true. Annulation de B avec perte
-- declaree a 0 (aucun mouvement de stock attendu pour B, cf.
-- order_item_lock_adr010.test.sql T4/T12 pour le contrat de la RPC). Paiement
-- de la commande pour 5000 (le total reel apres exclusion de B).
--
-- Run via MCP execute_sql sous BEGIN/ROLLBACK. Cashier fixe ...0002 (a
-- pos.sale.create + payments.process, cf. pay_existing_recipe_consumption
-- .test.sql). Le manager pour cancel_order_item_rpc_v6 est resolu dynamiquement
-- (role_code='MANAGER'), la RPC etant service_role-only / verifiee par
-- p_authorized_by, pas par auth.uid() (contexte postgres superuser en pgTAP,
-- cf. order_item_lock_adr010.test.sql:28-124).
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
UPDATE business_config SET allow_negative_stock=true WHERE id=1;

INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('00000000-0000-0000-0000-0000000cf019','00000000-0000-0000-0000-000000000002', 0, 'open');

INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, deduct_stock, unit) VALUES
  ('00000000-0000-0000-0000-0000000e1901','C-CANC-A','Lot C Item A','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',5000,'finished',10,true,true,'pcs'),
  ('00000000-0000-0000-0000-0000000e1902','C-CANC-B','Lot C Item B','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',3000,'finished',10,true,true,'pcs');

-- Fire dine-in (both lines land is_locked = true, per fire_counter_order_v7).
DO $$
DECLARE r jsonb;
BEGIN
  r := fire_counter_order_v7(
    p_client_uuid := '00000000-0000-0000-0000-0000000e19bb'::uuid,
    p_session_id := '00000000-0000-0000-0000-0000000cf019',
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000e1901","quantity":1,"unit_price":5000,"modifiers":[]},
                 {"product_id":"00000000-0000-0000-0000-0000000e1902","quantity":1,"unit_price":3000,"modifiers":[]}]'::jsonb,
    p_order_type := 'dine_in'::order_type,
    p_table_number := 'C-T1'
  );
  PERFORM set_config('c19.order_id', r->>'order_id', false);
END $$;

-- Cancel line B (locked -> waste declaration mandatory; 0 = nothing produced,
-- no stock_movements written per cancel_order_item_rpc_v6 contract).
DO $$
DECLARE
  v_item_b   UUID;
  v_mgr_prof UUID;
BEGIN
  SELECT id INTO v_item_b FROM order_items
    WHERE order_id = current_setting('c19.order_id')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000e1902';

  SELECT id INTO v_mgr_prof FROM user_profiles
    WHERE role_code = 'MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL
    ORDER BY created_at LIMIT 1;

  PERFORM cancel_order_item_rpc_v6(
    v_item_b, 'Lot C cancelled line', v_mgr_prof,
    '00000000-0000-0000-0000-000000000002'::uuid, NULL, 0);

  PERFORM set_config('c19.item_b', v_item_b::text, false);
END $$;

-- Pay for the remaining (non-cancelled) total only: 5000. Caught so T1 can
-- surface the exact SQLERRM on failure.
DO $$
DECLARE r jsonb;
BEGIN
  r := pay_existing_order_v19(
    p_order_id := current_setting('c19.order_id')::uuid,
    p_payment := '{"method":"cash","amount":5000,"cash_received":5000,"change_given":0}'::jsonb);
  PERFORM set_config('c19.pay_status', 'ok', false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('c19.pay_status', 'error', false);
  PERFORM set_config('c19.pay_err', SQLERRM, false);
END $$;

SELECT plan(7);
CREATE TEMP TABLE _cap(l text) ON COMMIT DROP;

INSERT INTO _cap SELECT ok(
  current_setting('c19.pay_status') = 'ok',
  'T1: payment of 5000 (cancelled line B excluded) succeeds -- ' ||
    COALESCE(current_setting('c19.pay_err', true), 'no error captured'));

INSERT INTO _cap SELECT ok(
  (SELECT total FROM orders WHERE id = current_setting('c19.order_id')::uuid) = 5000,
  'T2: orders.total = 5000 (cancelled line B excluded)');

INSERT INTO _cap SELECT ok(
  (SELECT subtotal FROM orders WHERE id = current_setting('c19.order_id')::uuid) = 5000,
  'T3: orders.subtotal = 5000 (cancelled line B excluded)');

INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id = '00000000-0000-0000-0000-0000000e1902') = 10
  AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = '00000000-0000-0000-0000-0000000e1902'),
  'T4: cancelled product B stock untouched, no stock_movements for B');

INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id = '00000000-0000-0000-0000-0000000e1901') = 9,
  'T5: sold product A stock deducted by 1 (10 -> 9)');

INSERT INTO _cap SELECT ok(
  NOT has_function_privilege('anon',
    'public.pay_existing_order_v19(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean)',
    'execute'),
  'T6: anon lacks EXECUTE on pay_existing_order_v19 (defense-in-depth REVOKE pair)');

INSERT INTO _cap SELECT hasnt_function('public', 'pay_existing_order_v18',
  ARRAY['uuid','jsonb','uuid','integer','uuid','numeric','text','numeric','text','uuid','uuid','jsonb','jsonb','boolean'],
  'T7: pay_existing_order_v18 no longer exists (dropped in the same migration as v19)');

SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l,' | ') AS lines FROM _cap;
ROLLBACK;
