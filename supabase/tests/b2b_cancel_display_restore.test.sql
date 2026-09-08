-- supabase/tests/b2b_cancel_display_restore.test.sql
-- Audit b2b-credit 2026-08-31, finding n°3 (P1) — l'annulation d'une facture B2B doit rendre
-- le stock VITRINE, pas seulement `products.current_stock`. La v1 recopiait la logique de
-- mouvement au lieu d'appeler un helper ; le helper a évolué (vitrine), la copie non.
--
-- Contrôle de MUTATION fait le 2026-09-08 avant de livrer : en rejouant la boucle exacte de
-- la v1 (INSERT stock_movements + UPDATE products, aucun geste vitrine) sur le même scénario,
-- `display_stock` restait à 8 au lieu de revenir à 10 — T2 échouait. Le test discrimine donc
-- bien le défaut ; un test vert qui ne peut pas rougir ne prouverait rien.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(4);

DO $$
DECLARE
  v_auth UUID; v_cust UUID; v_prod UUID;
  v_res jsonb; v_order UUID;
  v_disp_before numeric; v_disp_sold numeric; v_disp_after numeric;
  v_stock_before numeric; v_stock_after numeric;
  v_dm_before int; v_dm_after int;
BEGIN
  -- Acteur : il faut les DEUX droits, créer et annuler.
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id,'pos.sale.create')
     AND has_permission(up.auth_user_id,'b2b.order.cancel')
   ORDER BY up.employee_code LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'Aucun profil actif porteur de pos.sale.create + b2b.order.cancel'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cust FROM customers
   WHERE customer_type='b2b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'Aucun client B2B'; END IF;

  -- Produit de vitrine réel, choisi par ses données et non par un UUID en dur :
  -- un identifiant figé pourrit à la première purge de la base dev.
  SELECT p.id INTO v_prod
    FROM products p JOIN display_stock ds ON ds.product_id = p.id
   WHERE p.is_display_item AND p.deleted_at IS NULL AND COALESCE(p.track_inventory,true)
     AND ds.quantity >= 3 AND p.current_stock >= 3
   ORDER BY ds.quantity DESC LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'Aucun produit de vitrine avec assez de stock'; END IF;

  SELECT quantity      INTO v_disp_before  FROM display_stock WHERE product_id=v_prod;
  SELECT current_stock INTO v_stock_before FROM products      WHERE id=v_prod;
  SELECT count(*)      INTO v_dm_before    FROM display_movements WHERE product_id=v_prod;

  v_res := create_b2b_order_v7(v_cust,
             jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)),
             NULL, NULL, gen_random_uuid());
  v_order := (v_res->>'order_id')::uuid;

  SELECT quantity INTO v_disp_sold FROM display_stock WHERE product_id=v_prod;

  PERFORM cancel_b2b_order_v2(v_order, 'pgTAP display restore check', gen_random_uuid());

  SELECT quantity      INTO v_disp_after  FROM display_stock WHERE product_id=v_prod;
  SELECT current_stock INTO v_stock_after FROM products      WHERE id=v_prod;
  SELECT count(*)      INTO v_dm_after    FROM display_movements WHERE product_id=v_prod;

  PERFORM set_config('breakery.disp_before',  v_disp_before::text,  true);
  PERFORM set_config('breakery.disp_sold',    v_disp_sold::text,    true);
  PERFORM set_config('breakery.disp_after',   v_disp_after::text,   true);
  PERFORM set_config('breakery.stock_before', v_stock_before::text, true);
  PERFORM set_config('breakery.stock_after',  v_stock_after::text,  true);
  PERFORM set_config('breakery.dm_delta',    (v_dm_after - v_dm_before)::text, true);
END $$;

-- T1 : CONTRÔLE POSITIF de la porte d'entrée — sans lui, un scénario où rien ne bouge
-- passerait T2 et T3 sans rien prouver.
SELECT is(current_setting('breakery.disp_sold')::numeric,
          current_setting('breakery.disp_before')::numeric - 2,
          'T1 la vente B2B décrémente bien display_stock de 2');

SELECT is(current_setting('breakery.disp_after')::numeric,
          current_setting('breakery.disp_before')::numeric,
          'T2 après annulation, display_stock est revenu à son niveau initial');

SELECT is(current_setting('breakery.stock_after')::numeric,
          current_setting('breakery.stock_before')::numeric,
          'T3 après annulation, products.current_stock est revenu à son niveau initial');

SELECT is(current_setting('breakery.dm_delta')::int, 2,
          'T4 display_movements porte les DEUX gestes : la vente et la restitution');

SELECT * FROM finish();
ROLLBACK;
