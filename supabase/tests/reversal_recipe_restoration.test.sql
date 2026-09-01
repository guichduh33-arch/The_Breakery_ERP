-- reversal_recipe_restoration.test.sql
-- Bug 2026-09-01 — void_order_rpc_v11 / refund_order_rpc_v11 : le RETOUR est
-- desormais symetrique de la VENTE.
--
-- Avant (v10) : un fini non suivi en stock (track_inventory=false,
-- deduct_stock=true) consommait sa recette a la vente mais se voyait rendre
-- SON PROPRE stock au void/refund — d'ou des ingredients jamais restitues et
-- des finis a current_stock positif fantome. Et un produit ni suivi ni
-- deducteur (track=false, deduct=false), qui ne retire rien a la vente, se
-- voyait CREDITER du stock qui n'avait jamais existe.
--
-- Apres (v11), miroir exact de la branche de vente :
--   * vitrine ou suivi   -> son propre stock (inchange) ;
--   * deduct_stock seul  -> la recette (_resolve_recipe_consumption_v1) ;
--   * ni l'un ni l'autre -> rien.
--
-- Run via MCP execute_sql sous BEGIN/ROLLBACK. Manager ...0004 porte
-- pos.sale.create + payments.process + pos.sale.void + pos.sale.refund : il
-- vend ET annule depuis SA session ouverte (chemin meme-session, cash permis).
-- Capture des lignes TAP dans _cap et renvoie (failures, total, lines).

BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000004')::text, true);

DO $fixture$
DECLARE
  v_mgr_prof UUID := '00000000-0000-0000-0000-000000000004';
  v_mgr_auth UUID := '00000000-0000-0000-0000-000000000004';
  v_cat  UUID;
  v_sess UUID;
  v_ing   UUID := 'a11c0000-0000-4000-a000-000000000001';  -- suivi, ingredient
  v_mto   UUID := 'a11c0000-0000-4000-a000-000000000002';  -- non suivi + recette
  v_nod   UUID := 'a11c0000-0000-4000-a000-000000000003';  -- ni suivi ni deducteur
  v_trk   UUID := 'a11c0000-0000-4000-a000-000000000004';  -- suivi classique
  r JSONB; v_oi UUID;
BEGIN
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, deduct_stock, unit) VALUES
    (v_ing, 'RRR-ING', 'RRR Ingredient',   v_cat,     0, 'finished', 100, true,  true,  'pcs'),
    (v_mto, 'RRR-MTO', 'RRR MadeToOrder',  v_cat,  5000, 'finished',   0, false, true,  'pcs'),
    (v_nod, 'RRR-NOD', 'RRR NoDeduct',     v_cat,  3000, 'finished',   0, false, false, 'pcs'),
    (v_trk, 'RRR-TRK', 'RRR Tracked',      v_cat,  2000, 'finished',  10, true,  true,  'pcs');

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_mto, v_ing, 2, 'pcs', true);

  -- Session ouverte AU NOM du manager : le void et le refund empruntent alors
  -- le chemin meme-session (le chemin cross-shift refuserait le cash).
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_mgr_prof, 0, 'open') RETURNING id INTO v_sess;

  -- ===== Commande 1 : sera ANNULEE (void) =====
  r := complete_order_with_payment_v27(
    p_session_id := v_sess,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id', v_mto, 'quantity', 1, 'unit_price', 5000),
      jsonb_build_object('product_id', v_nod, 'quantity', 1, 'unit_price', 3000),
      jsonb_build_object('product_id', v_trk, 'quantity', 1, 'unit_price', 2000)),
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000));
  PERFORM set_config('rrr.order1', r->>'order_id', false);

  -- Photo APRES vente, AVANT annulation : c'est elle qui prouve que la vente a
  -- bien consomme la recette et rien d'autre.
  PERFORM set_config('rrr.ing_after_sale',
    (SELECT current_stock FROM products WHERE id = v_ing)::text, false);

  PERFORM void_order_rpc_v11(
    p_order_id            := current_setting('rrr.order1')::uuid,
    p_reason              := 'pgTAP reversal recipe restoration',
    p_authorized_by       := v_mgr_prof,
    p_acting_auth_user_id := v_mgr_auth);

  -- Photo APRES annulation : la commande 2 va reconsommer l'ingredient, donc
  -- l'etat post-void ne survit pas jusqu'aux assertions. On le fige ici.
  PERFORM set_config('rrr.ing_after_void',
    (SELECT current_stock FROM products WHERE id = v_ing)::text, false);

  -- ===== Commande 2 : sera REMBOURSEE a moitie =====
  r := complete_order_with_payment_v27(
    p_session_id := v_sess,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id', v_mto, 'quantity', 2, 'unit_price', 5000)),
    p_payment := jsonb_build_object('method','cash','amount',10000,'cash_received',10000));
  PERFORM set_config('rrr.order2', r->>'order_id', false);
  PERFORM set_config('rrr.ing_after_sale2',
    (SELECT current_stock FROM products WHERE id = v_ing)::text, false);

  SELECT id INTO v_oi FROM order_items WHERE order_id = current_setting('rrr.order2')::uuid LIMIT 1;
  r := refund_order_rpc_v11(
    current_setting('rrr.order2')::uuid,
    jsonb_build_array(jsonb_build_object('order_item_id', v_oi, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',5000)),
    'pgTAP partial refund recipe restoration',
    v_mgr_prof, NULL, v_mgr_auth);
  PERFORM set_config('rrr.refund2', r->>'refund_id', false);
END $fixture$;

SELECT plan(12);
CREATE TEMP TABLE _cap(l text) ON COMMIT DROP;

-- ===== La vente (rappel de l'invariant amont) =====
INSERT INTO _cap SELECT ok(
  current_setting('rrr.ing_after_sale')::numeric = 98,
  'T1: sale consumed the recipe (ingredient 100 - 2x1 = 98)');

-- ===== Le void =====
INSERT INTO _cap SELECT ok(
  (SELECT status::text FROM orders WHERE id = current_setting('rrr.order1')::uuid) = 'voided',
  'T2: order 1 is voided');
INSERT INTO _cap SELECT ok(
  current_setting('rrr.ing_after_void')::numeric = 100,
  'T3: void restored the INGREDIENT to its pre-sale level (98 + 2 = 100)');
INSERT INTO _cap SELECT ok(
  EXISTS (SELECT 1 FROM stock_movements
          WHERE product_id = 'a11c0000-0000-4000-a000-000000000001'
            AND movement_type = 'sale_void' AND quantity = 2
            AND reference_type = 'orders'
            AND reference_id = current_setting('rrr.order1')::uuid),
  'T4: void wrote a sale_void movement on the ingredient, referencing the order');
INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a11c0000-0000-4000-a000-000000000002') = 0,
  'T5: made-to-order product stock untouched by the void (v10 credited it to +1)');
INSERT INTO _cap SELECT ok(
  NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = 'a11c0000-0000-4000-a000-000000000002'),
  'T6: no stock movement at all on the made-to-order product (sale nor void)');

-- ===== Le produit ni suivi ni deducteur : la vente ne retire rien, le retour
-- ne rend rien. En v10 le void CREAIT du stock. =====
INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a11c0000-0000-4000-a000-000000000003') = 0,
  'T7: no-deduct product stock still 0 after void (v10 credited it to +1)');
INSERT INTO _cap SELECT ok(
  NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = 'a11c0000-0000-4000-a000-000000000003'),
  'T8: no stock movement at all on the no-deduct product');

-- ===== Non-regression : un produit suivi garde le comportement d'avant =====
INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a11c0000-0000-4000-a000-000000000004') = 10,
  'T9: tracked product still restored to its own stock by the void (10)');

-- ===== Le refund partiel : au prorata de la quantite rendue =====
INSERT INTO _cap SELECT ok(
  current_setting('rrr.ing_after_sale2')::numeric = 96,
  'T10: second sale consumed 2x2 = 4 of the ingredient (100 - 4 = 96)');
INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a11c0000-0000-4000-a000-000000000001') = 98,
  'T11: refunding 1 of 2 restored HALF the recipe (96 + 2 = 98)');
INSERT INTO _cap SELECT ok(
  EXISTS (SELECT 1 FROM stock_movements
          WHERE product_id = 'a11c0000-0000-4000-a000-000000000001'
            AND movement_type = 'sale_void' AND quantity = 2
            AND reference_type = 'refunds'
            AND reference_id = current_setting('rrr.refund2')::uuid),
  'T12: refund wrote a sale_void movement on the ingredient, referencing the refund');

SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
ROLLBACK;
