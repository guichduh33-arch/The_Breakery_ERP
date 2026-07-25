-- ADR-013 Lot 2 D12 — idempotence edit-items : re-check sous verrou (Option A).
-- Les 3 RPC lisaient la clé d'idempotence au début, faisaient le travail, puis
-- inséraient la clé à la fin. Deux appels concurrents même clé passaient tous
-- deux le pré-check (clé absente) → double travail + 23505 au 2e insert.
-- Fix (double-checked locking) : APRÈS le FOR UPDATE (qui sérialise les appels
-- même-ordre / même-item), re-lire la clé ; si trouvée → RETURN le résultat du
-- 1er, sans travail. Pour update_qty (ligne verrouillée), le re-check renvoie
-- AVANT la consommation du nonce → pas de double-consommation.
--
-- Bumps : add_order_item v1->v2, update_order_item_qty v2->v3, remove_order_item
-- v2->v3. Corps repris verbatim ; seul ajout = le re-check. ACL répliquée
-- (authenticated + service_role ; PUBLIC/anon révoqués).

-- ═══════════════════════════ add_order_item_v2 ═══════════════════════════
CREATE OR REPLACE FUNCTION public.add_order_item_v2(p_order_id uuid, p_product_id uuid, p_qty integer, p_modifiers jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_status        TEXT;
  v_product       RECORD;
  v_line_total    NUMERIC;
  v_order_item_id UUID;
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
  WHERE key = p_idempotency_key AND action = 'add';
  IF FOUND THEN RETURN v_replay; END IF;

  SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  -- D12 : re-check sous verrou (un appel concurrent même clé a pu committer
  -- entre le 1er check et l'acquisition du verrou).
  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'add';
  IF FOUND THEN RETURN v_replay; END IF;

  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002';
  END IF;
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT id, name, retail_price AS price, cost_price INTO v_product
  FROM products WHERE id = p_product_id AND is_active = true;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = 'P0002';
  END IF;
  v_line_total := v_product.price * p_qty;

  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers)
  VALUES (p_order_id, v_product.id, v_product.name, p_qty, v_product.price, v_line_total, COALESCE(p_modifiers, '[]'::jsonb))
  RETURNING id INTO v_order_item_id;

  PERFORM _recalc_order_totals(p_order_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.add', 'order', p_order_id,
          jsonb_build_object('order_item_id', v_order_item_id, 'product_id', v_product.id, 'qty', p_qty));

  v_result := jsonb_build_object('order_item_id', v_order_item_id,
    'order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total)
                     FROM orders WHERE id = p_order_id));

  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result)
  VALUES (p_idempotency_key, 'add', p_order_id, v_result);

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_order_item_v2(uuid, uuid, integer, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_order_item_v2(uuid, uuid, integer, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_order_item_v2(uuid, uuid, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_order_item_v2(uuid, uuid, integer, jsonb, uuid) TO service_role;
DROP FUNCTION IF EXISTS public.add_order_item_v1(uuid, uuid, integer, jsonb, uuid);

-- ═══════════════════════ update_order_item_qty_v3 ═══════════════════════
CREATE OR REPLACE FUNCTION public.update_order_item_qty_v3(p_order_item_id uuid, p_qty integer, p_idempotency_key uuid, p_auth_id uuid DEFAULT NULL::uuid, p_waste_qty numeric DEFAULT NULL::numeric, p_waste_reason text DEFAULT NULL::text)
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
    RAISE EXCEPTION 'Quantity must be positive (use remove_order_item_v3 for 0)' USING ERRCODE = '22023';
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

  -- D12 : re-check sous verrou (avant toute mutation / consommation de nonce).
  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;

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

REVOKE ALL ON FUNCTION public.update_order_item_qty_v3(uuid, integer, uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_order_item_qty_v3(uuid, integer, uuid, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v3(uuid, integer, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v3(uuid, integer, uuid, uuid, numeric, text) TO service_role;
DROP FUNCTION IF EXISTS public.update_order_item_qty_v2(uuid, integer, uuid, uuid, numeric, text);

-- ═══════════════════════════ remove_order_item_v3 ═══════════════════════════
CREATE OR REPLACE FUNCTION public.remove_order_item_v3(p_order_item_id uuid, p_idempotency_key uuid)
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

  -- D12 : re-check sous verrou.
  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'remove';
  IF FOUND THEN RETURN v_replay; END IF;

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

REVOKE ALL ON FUNCTION public.remove_order_item_v3(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_order_item_v3(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_order_item_v3(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_order_item_v3(uuid, uuid) TO service_role;
DROP FUNCTION IF EXISTS public.remove_order_item_v2(uuid, uuid);
