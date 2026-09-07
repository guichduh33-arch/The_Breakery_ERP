-- Audit lot 2, P1 — `hold_fired_order_v1` : la 4ᵉ sœur oubliée par la PR #495.
--
-- La v1 recalculait le montant de la commande parquée avec sa PROPRE somme :
--     SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = ...
-- Deux défauts dans cette seule ligne :
--   1. pas de `is_cancelled = false` — mettre en attente une commande dont une
--      ligne vient d'être annulée réécrit `orders.total` à sa valeur d'AVANT
--      l'annulation (même classe que le P0-1 fermé par 20260907000001) ;
--   2. `subtotal = total = v_items_total` sans passer par `_pb1_split_v1` —
--      `tax_amount` reste celui d'avant, donc faux, et en mode tax-exclusive le
--      total parqué serait hors taxe alors que l'encaissement la facturera.
--
-- Le correctif ne duplique pas la formule une cinquième fois : il DÉLÈGUE au
-- dépositaire unique `_recalc_order_totals`, désormais correct. C'est la leçon
-- de la garde CI `line-total-formula` — un calcul de total recopié est un bug
-- qui attend son tour.
--
-- Bump `_v1` → `_v2` avec DROP de l'ancienne dans la même migration (versioning
-- monotone). Signature, permission (`pos.sale.create`) et grants inchangés.
-- L'acteur passe par `_current_profile_id()`, comme les 32 RPC de la PR #499,
-- au lieu de résoudre le profil à la main.

CREATE OR REPLACE FUNCTION public.hold_fired_order_v2(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  UPDATE orders
     SET is_held = true
   WHERE id = p_order_id
     AND status = 'pending_payment'
     AND created_via = 'pos';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fired_order_not_found_or_not_holdable' USING ERRCODE = 'P0002';
  END IF;

  -- Le montant affiche dans la liste des commandes en attente vient du
  -- depositaire unique : il exclut les lignes annulees et applique le split PB1.
  PERFORM _recalc_order_totals(p_order_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (_current_profile_id(), 'order.held', 'orders', p_order_id, '{}'::jsonb);
END $function$;

COMMENT ON FUNCTION public.hold_fired_order_v2(uuid) IS
  'Parque une commande deja envoyee en cuisine (ADR-022 dec. 4). Le total est recalcule par _recalc_order_totals : lignes annulees exclues, split PB1 applique. Remplace v1 (somme locale sans is_cancelled ni split).';

REVOKE EXECUTE ON FUNCTION public.hold_fired_order_v2(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_fired_order_v2(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hold_fired_order_v2(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.hold_fired_order_v1(uuid);
