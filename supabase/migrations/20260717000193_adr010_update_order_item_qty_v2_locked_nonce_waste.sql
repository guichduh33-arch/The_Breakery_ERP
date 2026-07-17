-- ADR-010 (D1/D3/D4/D5) — update_order_item_qty_v1 → v2.
-- Corps copié du live (pg_get_functiondef). Ajouts v2 :
--   * ligne verrouillée (is_locked = true) :
--       - la quantité ne peut que BAISSER (hausse = ajout d'une nouvelle
--         ligne, jamais de retouche — ADR-010 D1) ;
--       - autorisation manager par nonce single-use scope 'order_item_edit'
--         (p_auth_id, consommation atomique : non consommé, non expiré ;
--         l'autorisateur est DÉRIVÉ du nonce, pas du body — parité S55) ;
--       - perte obligatoire sur le delta retiré : p_waste_qty ∈ [0, delta]
--         (défaut = delta), p_waste_reason ≥ 3 chars, déduction via
--         _record_order_item_waste_v1 (explosion flag-aware, rattachée
--         reference_type 'order_cancel'/reference_id = order_id) — sinon
--         « réduire au lieu d'annuler » serait le contournement (D5).
--   * ligne libre : comportement v1 inchangé (les args ADR-010 sont ignorés).
-- Replay idempotent inchangé (action 'update_qty') : le replay retourne le
-- résultat stocké sans consommer de nonce ni re-déduire.

CREATE OR REPLACE FUNCTION public.update_order_item_qty_v2(
  p_order_item_id uuid,
  p_qty integer,
  p_idempotency_key uuid,
  p_auth_id uuid DEFAULT NULL::uuid,
  p_waste_qty numeric DEFAULT NULL::numeric,
  p_waste_reason text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_order_id      UUID;
  v_status        TEXT;
  v_unit_price    NUMERIC;
  v_is_locked     BOOLEAN;
  v_old_qty       NUMERIC;
  v_product_id    UUID;
  v_combo         JSONB;
  v_delta         NUMERIC;
  v_waste         NUMERIC;
  v_authorized_by UUID;
  v_profile_id    UUID;
  v_replay        JSONB;
  v_result        JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN
    RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;

  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive (use remove_order_item_v2 for 0)' USING ERRCODE = '22023';
  END IF;

  SELECT oi.order_id, o.status, oi.unit_price, oi.is_locked, oi.quantity,
         oi.product_id, oi.combo_components
    INTO v_order_id, v_status, v_unit_price, v_is_locked, v_old_qty,
         v_product_id, v_combo
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

  IF v_is_locked THEN
    -- ADR-010 D1 : baisse seule ; la hausse passe par une nouvelle ligne.
    IF p_qty >= v_old_qty THEN
      RAISE EXCEPTION 'Locked line: quantity can only decrease (add a new line to increase)'
        USING ERRCODE = 'check_violation';
    END IF;
    v_delta := v_old_qty - p_qty;

    -- ADR-010 D3 : autorisation manager par nonce single-use, vérifiée serveur.
    IF p_auth_id IS NULL THEN
      RAISE EXCEPTION 'Manager authorization required (locked line)'
        USING ERRCODE = 'P0003';
    END IF;
    UPDATE discount_authorizations
       SET consumed_at = now(), consumed_order_id = v_order_id
     WHERE id = p_auth_id
       AND consumed_at IS NULL
       AND expires_at > now()
       AND scope = 'order_item_edit'
     RETURNING manager_profile_id INTO v_authorized_by;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or expired manager authorization'
        USING ERRCODE = 'P0003';
    END IF;

    -- ADR-010 D4 : perte obligatoire sur le delta (quantité ajustable par
    -- l'autorisateur, 0 = rien n'était produit — la déclaration reste tracée).
    v_waste := COALESCE(p_waste_qty, v_delta);
    IF v_waste < 0 OR v_waste > v_delta THEN
      RAISE EXCEPTION 'Waste quantity must be between 0 and % (removed delta)', v_delta
        USING ERRCODE = 'check_violation';
    END IF;
    IF length(coalesce(p_waste_reason, '')) < 3 THEN
      RAISE EXCEPTION 'Waste reason required (>= 3 chars)'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT id INTO v_profile_id FROM user_profiles
      WHERE auth_user_id = v_caller_id AND deleted_at IS NULL;
    IF v_profile_id IS NULL THEN
      RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE order_items SET quantity = p_qty, line_total = v_unit_price * p_qty
  WHERE id = p_order_item_id;

  PERFORM _recalc_order_totals(v_order_id);

  IF v_is_locked AND v_waste > 0 THEN
    PERFORM _record_order_item_waste_v1(
      p_order_item_id, v_order_id, v_product_id, v_combo,
      v_waste, p_waste_reason, v_profile_id);
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.update_qty', 'order', v_order_id,
          jsonb_build_object('order_item_id', p_order_item_id, 'new_qty', p_qty)
          || CASE WHEN v_is_locked THEN jsonb_build_object(
               'is_locked',     true,
               'authorized_by', v_authorized_by,
               'old_qty',       v_old_qty,
               'delta',         v_delta,
               'waste_qty',     v_waste,
               'waste_reason',  p_waste_reason)
             ELSE '{}'::jsonb END);

  v_result := jsonb_build_object('order_totals',
    (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total)
     FROM orders WHERE id = v_order_id));

  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result)
  VALUES (p_idempotency_key, 'update_qty', v_order_id, v_result);

  RETURN v_result;
END;
$function$;

-- Posture v1 répliquée : appelée directement par le client BO (authenticated).
REVOKE EXECUTE ON FUNCTION public.update_order_item_qty_v2(uuid, integer, uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_order_item_qty_v2(uuid, integer, uuid, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v2(uuid, integer, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v2(uuid, integer, uuid, uuid, numeric, text) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DROP FUNCTION public.update_order_item_qty_v1(uuid, integer, uuid);
