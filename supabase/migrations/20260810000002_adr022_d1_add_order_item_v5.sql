-- 20260810000002_adr022_d1_add_order_item_v5.sql
--
-- ADR-022 décision 1, troisième porte — l'édition d'une commande depuis le
-- back-office.
--
-- CONSTAT (corps live du 2026-08-10). add_order_item_v4 ne contrôlait que
-- `is_active = true`. Un produit soft-deleted et un produit-parent d'un groupe
-- de variantes entraient donc dans une commande ouverte par ce chemin, alors
-- que le money-path les refusait. La décision 1 pose une définition unique de
-- « vendable » : cette porte l'applique comme les deux autres.
--
-- PAS DE DRAPEAU DE TOLÉRANCE ICI. La décision 3 ne couvre que le rejeu
-- hors-ligne et l'appel d'appoint du checkout. Cette RPC n'est ni l'un ni
-- l'autre : elle est appelée en ligne, depuis le back-office, par un manager
-- devant son écran. Le refus y arrive à temps.
--
-- CHANGEMENT DE CODE D'ERREUR, assumé. Un produit désactivé levait
-- `P0002 / Product not found or inactive` ; il lève désormais
-- `check_violation / product_inactive: …`, et un parent
-- `check_violation / product_is_parent: …`. Aucun appelant ne dépendait de
-- l'ancienne chaîne (useAddOrderItem remonte le message brut), et les deux
-- nouveaux marqueurs sont déjà traduits par le classificateur partagé.
--
-- PROVENANCE DU CORPS. add_order_item_v4 repris de pg_get_functiondef sur
-- ikcyvlovptebroadgtvd le 2026-08-10 (3 319 caractères). Un seul emplacement
-- change ; le refus des combos (23514) et le style compact d'origine sont
-- conservés tels quels.

CREATE OR REPLACE FUNCTION public.add_order_item_v5(
  p_order_id uuid,
  p_product_id uuid,
  p_qty integer,
  p_modifiers jsonb,
  p_idempotency_key uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid(); v_status TEXT; v_customer_id UUID; v_product RECORD;
  v_order_item_id UUID; v_replay JSONB; v_result JSONB;
  v_lp RECORD;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'add';
  IF FOUND THEN RETURN v_replay; END IF;
  SELECT status, customer_id INTO v_status, v_customer_id FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'add';
  IF FOUND THEN RETURN v_replay; END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002'; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive' USING ERRCODE = '22023'; END IF;
  -- ADR-022 dec. 1 : meme regle de vendabilite que le money-path. v4 ne
  -- verifiait que is_active ; le soft-deleted et le produit-parent passaient.
  PERFORM _assert_product_sellable_v1(p_product_id, false);
  SELECT id, name, product_type INTO v_product FROM products WHERE id = p_product_id;
  IF v_product.product_type = 'combo' THEN
    RAISE EXCEPTION 'Combo products cannot be added from order edit (no composition)' USING ERRCODE = 'check_violation';
  END IF;
  -- ADR-013 D15/M2 : prix de base + modificateurs resolus SERVEUR (meme
  -- resolveur que complete_order_with_payment). price_adjustment client ignore.
  SELECT lp.unit_price, lp.modifiers_total, lp.line_subtotal, lp.modifiers_resolved
    INTO v_lp
    FROM _resolve_line_price_v2(p_product_id, p_qty::numeric, COALESCE(p_modifiers, '[]'::jsonb), v_customer_id, false, false) lp;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers, modifiers_total)
  VALUES (p_order_id, v_product.id, v_product.name, p_qty, v_lp.unit_price, v_lp.line_subtotal, v_lp.modifiers_resolved, round_idr(v_lp.modifiers_total * p_qty))
  RETURNING id INTO v_order_item_id;
  PERFORM _recalc_order_totals(p_order_id);
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.add', 'order', p_order_id, jsonb_build_object('order_item_id', v_order_item_id, 'product_id', v_product.id, 'qty', p_qty, 'unit_price', v_lp.unit_price, 'modifiers_total', round_idr(v_lp.modifiers_total * p_qty), 'rpc_version', 'v5-adr022'));
  v_result := jsonb_build_object('order_item_id', v_order_item_id,
    'order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total) FROM orders WHERE id = p_order_id));
  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result) VALUES (p_idempotency_key, 'add', p_order_id, v_result);
  RETURN v_result;
END;
$function$;

DROP FUNCTION IF EXISTS public.add_order_item_v4(uuid, uuid, integer, jsonb, uuid);

REVOKE ALL ON FUNCTION public.add_order_item_v5(uuid, uuid, integer, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_order_item_v5(uuid, uuid, integer, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_order_item_v5(uuid, uuid, integer, jsonb, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.add_order_item_v5(uuid, uuid, integer, jsonb, uuid) IS
  'ADR-022 dec. 1 — v5 = v4 + garde de vendabilite complete (_assert_product_sellable_v1) : v4 ne refusait que is_active=false, le soft-deleted et le produit-parent passaient. Aucun drapeau de tolerance : cette porte n''est ni rejouee hors-ligne ni appelee en finalisation d''encaissement.';
