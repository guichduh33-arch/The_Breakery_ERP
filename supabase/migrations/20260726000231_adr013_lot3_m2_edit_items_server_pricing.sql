-- ADR-013 Lot 3 (D15/M2) -- edit-items : tarification serveur via _resolve_line_price_v1.
--
--   add_order_item        v2 -> v3 : prix de base resolu serveur (B2B/categorie via
--     get_customer_product_price dans le resolveur) + modificateurs tarifes serveur
--     (price_adjustment client jamais cru) + modifiers_total renseigne. Les combos
--     sont REFUSES (le BO n'a pas d'UI de composition ; un combo sans composants
--     serait incoherent KDS/stock) -- arbitrage Mamat 2026-07-26.
--   update_order_item_qty v3 -> v4 : pricing HYBRIDE (arbitrage Mamat 2026-07-26) :
--     unit_price persiste CONSERVE (un changement de qty ne re-price jamais la base) ;
--     - ligne verrouillee (is_locked) : per-unit entierement GELE -- line_total et
--       modifiers_total sont re-echelonnes depuis les valeurs persistees (l'ancienne
--       v3 `line_total = unit_price * qty` PERDAIT la part modificateurs des lignes
--       firees, dont line_total inclut les modifiers depuis complete_order) ;
--     - ligne libre : modificateurs re-tarifes serveur via _resolve_line_price_v1
--       (blob client jamais cru), combo = unit_price persiste * qty.
--
-- Corps de depart = pg_get_functiondef LIVE (dump 2026-07-26, _224 D12).
-- Le re-check d'idempotence sous verrou (D12) est conserve verbatim.
-- DROP v2/v3 dans la meme migration (versioning monotone). Types a regenerer.

CREATE OR REPLACE FUNCTION public.add_order_item_v3(p_order_id uuid, p_product_id uuid, p_qty integer, p_modifiers jsonb, p_idempotency_key uuid)
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
  SELECT id, name, product_type INTO v_product FROM products WHERE id = p_product_id AND is_active = true;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = 'P0002'; END IF;
  IF v_product.product_type = 'combo' THEN
    RAISE EXCEPTION 'Combo products cannot be added from order edit (no composition)' USING ERRCODE = 'check_violation';
  END IF;
  -- ADR-013 D15/M2 : prix de base + modificateurs resolus SERVEUR (meme
  -- resolveur que complete_order_with_payment). price_adjustment client ignore.
  SELECT lp.unit_price, lp.modifiers_total, lp.line_subtotal, lp.modifiers_resolved
    INTO v_lp
    FROM _resolve_line_price_v1(p_product_id, p_qty::numeric, COALESCE(p_modifiers, '[]'::jsonb), v_customer_id, false, false) lp;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers, modifiers_total)
  VALUES (p_order_id, v_product.id, v_product.name, p_qty, v_lp.unit_price, v_lp.line_subtotal, v_lp.modifiers_resolved, round_idr(v_lp.modifiers_total * p_qty))
  RETURNING id INTO v_order_item_id;
  PERFORM _recalc_order_totals(p_order_id);
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.add', 'order', p_order_id, jsonb_build_object('order_item_id', v_order_item_id, 'product_id', v_product.id, 'qty', p_qty, 'unit_price', v_lp.unit_price, 'modifiers_total', round_idr(v_lp.modifiers_total * p_qty), 'rpc_version', 'v3-adr013-lot3'));
  v_result := jsonb_build_object('order_item_id', v_order_item_id,
    'order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total) FROM orders WHERE id = p_order_id));
  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result) VALUES (p_idempotency_key, 'add', p_order_id, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_order_item_qty_v4(p_order_item_id uuid, p_qty integer, p_idempotency_key uuid, p_auth_id uuid DEFAULT NULL::uuid, p_waste_qty numeric DEFAULT NULL::numeric, p_waste_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid(); v_order_id UUID; v_status TEXT; v_unit_price NUMERIC; v_is_locked BOOLEAN;
  v_old_qty NUMERIC; v_product_id UUID; v_combo JSONB; v_delta NUMERIC; v_waste NUMERIC;
  v_authorized_by UUID; v_profile_id UUID; v_replay JSONB; v_result JSONB;
  v_customer_id UUID; v_modifiers JSONB; v_is_gift BOOLEAN; v_product_type TEXT;
  v_old_line_total NUMERIC; v_old_mod_total NUMERIC;
  v_new_line_total NUMERIC; v_new_mod_total NUMERIC; v_new_modifiers JSONB;
  v_lp RECORD;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive (use remove_order_item_v3 for 0)' USING ERRCODE = '22023'; END IF;
  SELECT oi.order_id, o.status, oi.unit_price, oi.is_locked, oi.quantity, oi.product_id, oi.combo_components,
         o.customer_id, oi.modifiers, COALESCE(oi.is_promo_gift, false), p.product_type::text,
         oi.line_total, oi.modifiers_total
    INTO v_order_id, v_status, v_unit_price, v_is_locked, v_old_qty, v_product_id, v_combo,
         v_customer_id, v_modifiers, v_is_gift, v_product_type,
         v_old_line_total, v_old_mod_total
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE oi.id = p_order_item_id FOR UPDATE OF oi, o;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002'; END IF;
  IF v_is_locked THEN
    IF p_qty >= v_old_qty THEN RAISE EXCEPTION 'Locked line: quantity can only decrease (add a new line to increase)' USING ERRCODE = 'check_violation'; END IF;
    v_delta := v_old_qty - p_qty;
    IF p_auth_id IS NULL THEN RAISE EXCEPTION 'Manager authorization required (locked line)' USING ERRCODE = 'P0003'; END IF;
    UPDATE discount_authorizations SET consumed_at = now(), consumed_order_id = v_order_id
     WHERE id = p_auth_id AND consumed_at IS NULL AND expires_at > now() AND scope = 'order_item_edit'
     RETURNING manager_profile_id INTO v_authorized_by;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired manager authorization' USING ERRCODE = 'P0003'; END IF;
    v_waste := COALESCE(p_waste_qty, v_delta);
    IF v_waste < 0 OR v_waste > v_delta THEN RAISE EXCEPTION 'Waste quantity must be between 0 and % (removed delta)', v_delta USING ERRCODE = 'check_violation'; END IF;
    IF length(coalesce(p_waste_reason, '')) < 3 THEN RAISE EXCEPTION 'Waste reason required (>= 3 chars)' USING ERRCODE = 'check_violation'; END IF;
    SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_caller_id AND deleted_at IS NULL;
    IF v_profile_id IS NULL THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001'; END IF;
  END IF;
  -- ADR-013 D15/M2 -- pricing hybride :
  IF v_is_locked THEN
    -- Ligne firee : per-unit entierement GELE, simple re-echelonnage du persiste.
    -- (l'ancienne v3 `unit_price * qty` perdait la part modificateurs des lignes
    -- firees ; et une re-resolution pourrait echouer sur un modificateur
    -- desactive depuis le fire -- interdit de bloquer une baisse autorisee.)
    v_new_line_total := round_idr(v_old_line_total / v_old_qty * p_qty);
    v_new_mod_total  := CASE WHEN v_old_mod_total IS NULL THEN NULL ELSE round_idr(v_old_mod_total / v_old_qty * p_qty) END;
    v_new_modifiers  := v_modifiers;
  ELSIF v_product_type = 'combo' OR v_combo IS NOT NULL THEN
    -- Combo : unit_price persiste (inclut les surcharges de composition), pas de modifiers.
    v_new_line_total := round_idr(v_unit_price * p_qty);
    v_new_mod_total  := v_old_mod_total;
    v_new_modifiers  := v_modifiers;
  ELSE
    -- Ligne libre : unit_price persiste CONSERVE, modificateurs re-tarifes
    -- serveur (le price_adjustment du blob persiste n'est jamais cru).
    SELECT lp.modifiers_total, lp.modifiers_resolved INTO v_lp
      FROM _resolve_line_price_v1(v_product_id, p_qty::numeric, COALESCE(v_modifiers, '[]'::jsonb), v_customer_id, v_is_gift, false) lp;
    v_new_line_total := round_idr((v_unit_price + v_lp.modifiers_total) * p_qty);
    v_new_mod_total  := round_idr(v_lp.modifiers_total * p_qty);
    v_new_modifiers  := v_lp.modifiers_resolved;
  END IF;
  UPDATE order_items
     SET quantity = p_qty, line_total = v_new_line_total, modifiers_total = v_new_mod_total, modifiers = v_new_modifiers
   WHERE id = p_order_item_id;
  PERFORM _recalc_order_totals(v_order_id);
  IF v_is_locked AND v_waste > 0 THEN
    PERFORM _record_order_item_waste_v1(p_order_item_id, v_order_id, v_product_id, v_combo, v_waste, p_waste_reason, v_profile_id);
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.update_qty', 'order', v_order_id,
          jsonb_build_object('order_item_id', p_order_item_id, 'new_qty', p_qty, 'rpc_version', 'v4-adr013-lot3')
          || CASE WHEN v_is_locked THEN jsonb_build_object('is_locked', true, 'authorized_by', v_authorized_by, 'old_qty', v_old_qty, 'delta', v_delta, 'waste_qty', v_waste, 'waste_reason', p_waste_reason) ELSE '{}'::jsonb END);
  v_result := jsonb_build_object('order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total) FROM orders WHERE id = v_order_id));
  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result) VALUES (p_idempotency_key, 'update_qty', v_order_id, v_result);
  RETURN v_result;
END;
$function$;

DROP FUNCTION IF EXISTS public.add_order_item_v2(uuid, uuid, integer, jsonb, uuid);
DROP FUNCTION IF EXISTS public.update_order_item_qty_v3(uuid, integer, uuid, uuid, numeric, text);

-- ACL defense-en-profondeur (anon herite EXECUTE via PUBLIC -- REVOKE des deux).
REVOKE ALL ON FUNCTION public.add_order_item_v3(uuid, uuid, integer, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_order_item_v3(uuid, uuid, integer, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_order_item_v3(uuid, uuid, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_order_item_v3(uuid, uuid, integer, jsonb, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.update_order_item_qty_v4(uuid, integer, uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_order_item_qty_v4(uuid, integer, uuid, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v4(uuid, integer, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v4(uuid, integer, uuid, uuid, numeric, text) TO service_role;

COMMENT ON FUNCTION public.add_order_item_v3(uuid, uuid, integer, jsonb, uuid) IS
  'BO edit-items : ajout de ligne, pricing serveur via _resolve_line_price_v1 (base B2B/categorie + modificateurs), combos refuses. v3 ADR-013 Lot 3 (D15/M2).';
COMMENT ON FUNCTION public.update_order_item_qty_v4(uuid, integer, uuid, uuid, numeric, text) IS
  'BO edit-items : changement de quantite, pricing hybride (unit_price persiste conserve ; locked = per-unit gele ; libre = modificateurs re-tarifes serveur). v4 ADR-013 Lot 3 (D15/M2).';
