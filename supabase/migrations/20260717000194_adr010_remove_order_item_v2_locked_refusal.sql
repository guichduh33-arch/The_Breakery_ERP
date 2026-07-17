-- ADR-010 (D5) — remove_order_item_v1 → v2.
-- Corps copié du live (pg_get_functiondef). Ajout v2 : une ligne verrouillée
-- (is_locked = true, KOT émis) REFUSE la suppression et renvoie vers le flux
-- cancel (EF cancel-item, PIN manager + perte obligatoire) — sinon le DELETE
-- contournerait la déclaration de perte du D4. Ligne libre : comportement v1
-- inchangé (action idempotency 'remove').

CREATE OR REPLACE FUNCTION public.remove_order_item_v2(p_order_item_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_order_id  UUID;
  v_status    TEXT;
  v_is_locked BOOLEAN;
  v_replay    JSONB;
  v_result    JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN
    RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'remove';
  IF FOUND THEN RETURN v_replay; END IF;

  SELECT oi.order_id, o.status, oi.is_locked INTO v_order_id, v_status, v_is_locked
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002';
  END IF;

  -- ADR-010 D5 : une seule porte de sortie pour un item verrouillé.
  IF v_is_locked THEN
    RAISE EXCEPTION 'Locked item: removal forbidden — use the cancel flow (mandatory waste declaration)'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM order_items WHERE id = p_order_item_id;
  PERFORM _recalc_order_totals(v_order_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.remove', 'order', v_order_id,
          jsonb_build_object('order_item_id', p_order_item_id));

  v_result := jsonb_build_object('order_totals',
    (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total)
     FROM orders WHERE id = v_order_id));

  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result)
  VALUES (p_idempotency_key, 'remove', v_order_id, v_result);

  RETURN v_result;
END;
$function$;

-- Posture v1 répliquée : appelée directement par le client BO (authenticated).
REVOKE EXECUTE ON FUNCTION public.remove_order_item_v2(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_order_item_v2(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_order_item_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_order_item_v2(uuid, uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DROP FUNCTION public.remove_order_item_v1(uuid, uuid);
