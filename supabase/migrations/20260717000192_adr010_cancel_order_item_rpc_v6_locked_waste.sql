-- ADR-010 (D1/D4/D5) — cancel_order_item_rpc_v5 → v6.
-- Corps copié du live (pg_get_functiondef). Ajouts v6 :
--   * la ligne est lue avec is_locked / quantity / product_id / combo_components ;
--   * item verrouillé (is_locked = true, KOT émis) ⇒ déclaration de perte
--     OBLIGATOIRE : p_waste_qty NOT NULL, borné [0, quantité de la ligne]
--     (0 = « rien n'était produit », jugement de l'autorisateur — la
--     déclaration reste tracée dans audit_logs). La raison de la perte est la
--     raison du cancel (même flux, une seule raison — ADR-010 D4).
--   * perte > 0 ⇒ _record_order_item_waste_v1 (explosion flag-aware, waste
--     rattaché reference_type 'order_cancel'/reference_id = order_id) dans la
--     même transaction que l'annulation.
--   * item NON verrouillé : comportement v5 inchangé (pré-KOT, rien produit,
--     aucune perte) — p_waste_qty ignoré.
-- Le PIN manager reste vérifié dans l'EF cancel-item (header x-manager-pin),
-- la RPC reste service_role-only. Replay idempotent inchangé (la perte vit
-- dans la 1re exécution ; le replay retourne l'enveloppe sans re-déduire).

CREATE OR REPLACE FUNCTION public.cancel_order_item_rpc_v6(
  p_order_item_id uuid,
  p_reason text,
  p_authorized_by uuid,
  p_acting_auth_user_id uuid,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_waste_qty numeric DEFAULT NULL::numeric
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order_id       UUID;
  v_order_status   order_status;
  v_kitchen_status TEXT;
  v_is_cancelled   BOOLEAN;
  v_is_locked      BOOLEAN;
  v_quantity       NUMERIC;
  v_product_id     UUID;
  v_combo          JSONB;
  v_dispatch       TEXT;
  v_order_number   TEXT;
  v_name           TEXT;
  v_new_subtotal   DECIMAL(14,2);
  v_new_tax        DECIMAL(14,2);
  v_new_total      DECIMAL(14,2);
  v_replay         RECORD;
BEGIN
  v_user_id := p_acting_auth_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  -- v3 idempotency replay : même clé → renvoyer l'enveloppe du premier cancel.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT oi.id AS order_item_id, oi.order_id, o.order_number, oi.name_snapshot,
           oi.dispatch_station, o.subtotal, o.tax_amount, o.total
      INTO v_replay
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.cancel_idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_item_id', v_replay.order_item_id, 'order_id', v_replay.order_id,
        'order_number', v_replay.order_number, 'item_name', v_replay.name_snapshot,
        'dispatch_station', v_replay.dispatch_station,
        'new_subtotal', v_replay.subtotal, 'new_tax_amount', v_replay.tax_amount,
        'new_total', v_replay.total, 'idempotent_replay', true);
    END IF;
  END IF;

  IF p_authorized_by IS NULL THEN
    RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003';
  END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.cancel_item') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.cancel_item'
      USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT oi.order_id, o.status, oi.kitchen_status, oi.is_cancelled,
         oi.is_locked, oi.quantity, oi.product_id, oi.combo_components,
         oi.dispatch_station, o.order_number, oi.name_snapshot
    INTO v_order_id, v_order_status, v_kitchen_status, v_is_cancelled,
         v_is_locked, v_quantity, v_product_id, v_combo,
         v_dispatch, v_order_number, v_name
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.id = p_order_item_id
    FOR UPDATE OF oi;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002';
  END IF;
  -- ADR-009 déc. 3 : draft OU pending_payment (commande tirée non payée).
  IF v_order_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'Cannot cancel item on % order (use refund flow)', v_order_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_kitchen_status = 'served' THEN
    RAISE EXCEPTION 'Cannot cancel served item (use refund flow)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_is_cancelled THEN
    RAISE EXCEPTION 'Item already cancelled' USING ERRCODE = 'check_violation';
  END IF;

  -- ADR-010 D4 : item envoyé en cuisine ⇒ déclaration de perte obligatoire.
  IF v_is_locked THEN
    IF p_waste_qty IS NULL THEN
      RAISE EXCEPTION 'Waste declaration required to cancel a kitchen-sent item'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_waste_qty < 0 OR p_waste_qty > v_quantity THEN
      RAISE EXCEPTION 'Waste quantity must be between 0 and % (line quantity)', v_quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE order_items SET
    is_cancelled           = true,
    cancelled_at           = now(),
    cancelled_reason       = p_reason,
    cancelled_by           = p_authorized_by,
    cancel_idempotency_key = p_idempotency_key
  WHERE id = p_order_item_id;

  IF v_is_locked AND p_waste_qty > 0 THEN
    PERFORM _record_order_item_waste_v1(
      p_order_item_id, v_order_id, v_product_id, v_combo,
      p_waste_qty, p_reason, v_profile_id);
  END IF;

  SELECT COALESCE(SUM(line_total), 0)
    INTO v_new_subtotal
    FROM order_items
    WHERE order_id = v_order_id AND is_cancelled = false;

  SELECT s.tax_amount, s.total
    INTO v_new_tax, v_new_total
    FROM _pb1_split_v1(v_new_subtotal) s;

  UPDATE orders
    SET subtotal   = v_new_subtotal,
        tax_amount = v_new_tax,
        total      = v_new_total,
        updated_at = now()
    WHERE id = v_order_id;

  -- Audit: actor = approving MANAGER (non-repudiation); cashier recorded in metadata.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_authorized_by, 'order.cancel_item', 'order_items', p_order_item_id, jsonb_build_object(
    'order_id',          v_order_id,
    'order_number',      v_order_number,
    'item_name',         v_name,
    'reason',            p_reason,
    'authorized_by',     p_authorized_by,
    'acting_cashier_id', v_profile_id,
    'dispatch_station',  v_dispatch,
    'new_subtotal',      v_new_subtotal,
    'new_total',         v_new_total,
    'is_locked',         v_is_locked,
    'waste_qty',         CASE WHEN v_is_locked THEN p_waste_qty ELSE NULL END
  ));

  RETURN jsonb_build_object(
    'order_item_id',    p_order_item_id,
    'order_id',         v_order_id,
    'order_number',     v_order_number,
    'item_name',        v_name,
    'dispatch_station', v_dispatch,
    'new_subtotal',     v_new_subtotal,
    'new_tax_amount',   v_new_tax,
    'new_total',        v_new_total,
    'waste_qty',        CASE WHEN v_is_locked THEN p_waste_qty ELSE NULL END
  );
END $function$;

-- Posture v5 répliquée : service_role only (l'EF cancel-item passe par l'admin client).
REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v6(uuid, text, uuid, uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v6(uuid, text, uuid, uuid, uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v6(uuid, text, uuid, uuid, uuid, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_item_rpc_v6(uuid, text, uuid, uuid, uuid, numeric) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DROP FUNCTION public.cancel_order_item_rpc_v5(uuid, text, uuid, uuid, uuid);
