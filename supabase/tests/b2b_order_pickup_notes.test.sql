-- supabase/tests/b2b_order_pickup_notes.test.sql
-- Audit b2b-credit 2026-08-31, finding n°4 (P1) — la date de retrait et les notes saisies à
-- la création d'un ordre B2B doivent atterrir sur `orders`, pas seulement dans `audit_logs`.
--
-- Avant la v7, `create_b2b_order` n'écrivait ni `orders.pickup_date` ni `orders.notes` : la
-- colonne « Pickup » du back-office était structurellement vide (22/22 NULL sur dev), et la
-- note de l'opérateur — référence de PO, consigne de retrait — était perdue à la seconde
-- près où il validait.
--
-- Le test est discriminant PAR CONSTRUCTION : sur la v6, T1 et T2 lisent NULL. Ce n'est pas
-- une garde sur une valeur déjà présente, c'est la lecture de ce que la RPC vient d'écrire.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(3);

DO $$
DECLARE v_auth UUID; v_cust UUID; v_prod UUID; v_res jsonb; v_o record;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id,'pos.sale.create')
   ORDER BY up.employee_code LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'Aucun profil actif porteur de pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cust FROM customers
   WHERE customer_type='b2b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'Aucun client B2B'; END IF;

  SELECT id INTO v_prod FROM products
   WHERE deleted_at IS NULL AND COALESCE(track_inventory,true) AND current_stock > 3
   ORDER BY name LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'Aucun produit stocké disponible'; END IF;

  -- Saisie complète, avec des espaces autour de la note comme en frappe réelle.
  v_res := create_b2b_order_v7(v_cust,
             jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
             '  PO-4711 pickup at 9am  ', DATE '2026-09-20', gen_random_uuid());
  SELECT pickup_date, notes INTO v_o FROM orders WHERE id=(v_res->>'order_id')::uuid;
  PERFORM set_config('breakery.pd', COALESCE(v_o.pickup_date::text,'NULL'), true);
  PERFORM set_config('breakery.nt', COALESCE(v_o.notes,'NULL'), true);

  -- Note faite d'espaces : elle ne doit pas devenir une chaîne vide en base.
  v_res := create_b2b_order_v7(v_cust,
             jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
             '   ', NULL, gen_random_uuid());
  SELECT notes INTO v_o FROM orders WHERE id=(v_res->>'order_id')::uuid;
  PERFORM set_config('breakery.nt_blank', COALESCE(v_o.notes,'NULL'), true);
END $$;

SELECT is(current_setting('breakery.pd'), '2026-09-20',
  'T1 pickup_date est écrite sur orders');
SELECT is(current_setting('breakery.nt'), 'PO-4711 pickup at 9am',
  'T2 notes est écrite sur orders, débarrassée des espaces de bord');
SELECT is(current_setting('breakery.nt_blank'), 'NULL',
  'T3 une note faite d''espaces reste NULL, jamais une chaîne vide');

SELECT * FROM finish();
ROLLBACK;
