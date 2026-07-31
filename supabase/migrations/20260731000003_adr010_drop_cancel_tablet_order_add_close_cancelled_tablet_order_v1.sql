-- Audit Tablet Ordering (2026-07-31), décision propriétaire du 2026-07-31.
--
-- 1) `cancel_tablet_order` est SUPPRIMÉE. Elle laissait une serveuse annuler
--    seule, depuis la salle, une commande dont TOUTES les lignes sont posées
--    `is_locked = true` + `sent_to_kitchen_at` dès la création par
--    `create_tablet_order` — donc déjà en production en cuisine. Ni autorisation
--    manager (ADR-010 D3), ni déclaration de perte (D4), ni trace. La seule
--    porte de sortie d'un item verrouillé reste le flux cancel-item
--    (`cancel_order_item_rpc`), qui exige le PIN manager ET la perte, et qui
--    accepte déjà les statuts 'draft' ET 'pending_payment'.
--
-- 2) Une fois toutes les lignes annulées par ce flux, la commande restait en
--    'pending_payment' avec un total à 0 — donc affichée indéfiniment dans
--    l'inbox du caissier, qui filtre sur ce statut. `close_cancelled_tablet_order_v1`
--    la ferme, et SEULEMENT dans ce cas : la garde « toutes les lignes déjà
--    annulées » rend impossible de contourner l'ADR-010 par cette porte — la
--    perte a nécessairement été déclarée ligne à ligne avant.
--
-- Note comptable : le passage à 'voided' déclenche `trg_create_sale_journal_entry_upd`,
-- dont la branche d'extourne exige OLD.status IN ('paid','completed'). Une
-- commande tablette non encaissée n'y entre pas — aucune écriture parasite.

DROP FUNCTION IF EXISTS public.cancel_tablet_order(uuid);

CREATE OR REPLACE FUNCTION public.close_cancelled_tablet_order_v1(
  p_order_id UUID,
  p_reason   TEXT DEFAULT 'All lines cancelled'
) RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_profile_id UUID;
  v_order      orders;
  v_total      INTEGER;
  v_cancelled  INTEGER;
  v_row        orders;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_user_id;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_user_id, 'payments.process') THEN
    RAISE EXCEPTION 'Permission denied: payments.process' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.created_via <> 'tablet' THEN
    RAISE EXCEPTION 'Not a tablet order' USING ERRCODE = 'check_violation';
  END IF;

  IF v_order.status NOT IN ('pending_payment', 'draft') THEN
    RAISE EXCEPTION 'Cannot close % order', v_order.status USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_cancelled)
    INTO v_total, v_cancelled
    FROM order_items WHERE order_id = p_order_id;

  -- Garde ADR-010 : la clôture ne fait que constater. Elle n'annule rien et ne
  -- peut donc pas servir de contournement au flux cancel-item.
  IF v_total = 0 OR v_cancelled < v_total THEN
    RAISE EXCEPTION 'Cannot close: % of % lines still active (cancel them first)',
      v_total - v_cancelled, v_total USING ERRCODE = 'P0014';
  END IF;

  UPDATE orders
    SET status      = 'voided',
        voided_at   = now(),
        voided_by   = v_profile_id,
        void_reason = p_reason,
        updated_at  = now()
    WHERE id = p_order_id
    RETURNING * INTO v_row;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.close_cancelled_tablet', 'orders', p_order_id,
          jsonb_build_object('order_number', v_row.order_number,
                             'lines_cancelled', v_cancelled,
                             'reason', p_reason));

  RETURN v_row;
END $$;

REVOKE ALL     ON FUNCTION public.close_cancelled_tablet_order_v1(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_cancelled_tablet_order_v1(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.close_cancelled_tablet_order_v1(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.close_cancelled_tablet_order_v1 IS
  'ADR-010 — ferme une commande tablette dont TOUTES les lignes sont deja annulees (pending_payment|draft -> voided). Refuse P0014 sinon. Remplace cancel_tablet_order, supprimee.';
