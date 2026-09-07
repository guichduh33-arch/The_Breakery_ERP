-- Audit lot 2, P0 n°1 — `_recalc_order_totals` ressuscitait les lignes annulées.
--
-- Le helper sommait `line_total` sur TOUTES les lignes de la commande, sans le
-- prédicat `is_cancelled = false`. `cancel_order_item_rpc_v6` recalcule le bon
-- total, mais le geste d'édition suivant (`add_order_item_v6`,
-- `update_order_item_qty_v6`, `remove_order_item_v4`) rappelle ce helper et
-- remet l'article annulé dans `orders.total` — le client paie ce qui a été annulé.
--
-- La PR #495 (`a582d98a`) a fermé le paiement, la réouverture et l'ardoise ;
-- elle n'a pas touché ce helper commun, qui est en amont des trois.
--
-- Le helper n'est pas versionné (pas de suffixe `_vN`) : `CREATE OR REPLACE` est
-- la forme attendue ici, et il préserve l'ACL existante (`postgres`, `service_role`).
-- Aucune signature ne change, les quatre appelants sont inchangés.

CREATE OR REPLACE FUNCTION public._recalc_order_totals(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_items_total NUMERIC := 0;
  v_subtotal    NUMERIC;
  v_tax         NUMERIC;
  v_total       NUMERIC;
BEGIN
  -- Une ligne annulee ne se facture pas. Miroir du recalcul deja porte par
  -- cancel_order_item_rpc_v6 et des lectures de pay_existing_order_v19.
  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
  FROM order_items
  WHERE order_id = p_order_id
    AND is_cancelled = false;

  -- Le mode taxe (inclusive/exclusive) vit UNIQUEMENT dans _pb1_split_v1.
  SELECT subtotal, tax_amount, total
    INTO v_subtotal, v_tax, v_total
  FROM _pb1_split_v1(v_items_total);

  UPDATE orders SET
    subtotal   = v_subtotal,
    tax_amount = v_tax,
    total      = v_total,
    updated_at = now()
  WHERE id = p_order_id;
END;
$function$;

COMMENT ON FUNCTION public._recalc_order_totals(uuid) IS
  'Recalcule subtotal/tax/total d''une commande depuis ses lignes NON annulees. Audit lot 2 P0-1 : le predicat is_cancelled = false manquait.';
