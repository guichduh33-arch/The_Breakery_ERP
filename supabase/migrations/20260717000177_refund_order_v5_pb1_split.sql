-- 20260717000177_refund_order_v5_pb1_split.sql
-- Lot 6a (7/8) — refund_order_rpc_v4 -> _v5 : formule PB1 -> _pb1_split_v1.
--
-- A COMPORTEMENT CONSTANT en mode inclusive (tax_inclusive = true).
--
-- ⚠️ Substitution DIFFERENTE des bumps _174/_175 : le split remonte AVANT le
-- plafond anti-sur-remboursement et la validation des tenders, au lieu de
-- remplacer la formule a son ancien emplacement (apres ces controles). Raison :
-- en mode exclusive, les parts de lignes (line_total) sont HT alors que le
-- client a paye TTC. Si le split restait en aval, le client serait rembourse
-- HT — la taxe qu'il a payee resterait en caisse — et refunds.total divergerait
-- de la somme des refund_payments. En mode inclusive, deplacer le split ne
-- change RIEN : total inchange, meme taxe (meme base, meme taux).
--
-- Provenance : corps de _018 PROUVE equivalent au live avant reprise
-- (2026-07-17 : normalisation espaces, seul ecart = un retour a la ligne dans
-- jsonb_build_object — cosmetique ; les 105 vs 130 lignes ne sont que du
-- reformatage dense cote pg_get_functiondef). Substitutions scriptees.
--
-- Grants v4 releves live (reversal_rpc_revoke 11/11) : anon=false,
-- authenticated=FALSE, service_role=true. L'EF refund-order appelle via
-- admin.rpc() — PAS de GRANT authenticated ; le REVOKE l'inclut explicitement
-- (un bump repart d'une ACL fraiche, cf. incidents 20260709000010/20260710000084).

CREATE OR REPLACE FUNCTION public.refund_order_rpc_v5(p_order_id uuid, p_lines jsonb, p_tenders jsonb, p_reason text, p_authorized_by uuid, p_idempotency_key uuid, p_acting_auth_user_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID; v_profile_id UUID; v_order RECORD; v_open_session UUID; v_line_entry JSONB; v_oi_id UUID; v_oi RECORD;
  v_qty_req DECIMAL(14,3); v_qty_already DECIMAL(14,3); v_amount_line DECIMAL(14,2); v_refund_total DECIMAL(14,2) := 0;
  v_tax_refunded DECIMAL(14,2); v_prior_refunds DECIMAL(14,2); v_tender_entry JSONB;
  v_tender_method payment_method; v_tender_amt DECIMAL(14,2); v_tender_sum DECIMAL(14,2) := 0; v_method_paid DECIMAL(14,2);
  v_method_refunded DECIMAL(14,2); v_refund_id UUID; v_refund_number TEXT; v_seq_number INTEGER; v_loyalty_now INTEGER;
  v_pts_to_deduct INTEGER := 0; v_loyalty_ratio DECIMAL(8,4); v_product_id UUID; v_existing RECORD;
  v_ptype TEXT; v_comp JSONB; v_comp_qty NUMERIC; v_ing RECORD; v_restore NUMERIC;
BEGIN
  v_user_id := p_acting_auth_user_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001'; END IF;
  IF p_authorized_by IS NULL THEN RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003'; END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.refund') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.refund' USING ERRCODE = 'P0003'; END IF;
  IF length(coalesce(p_reason,'')) < 3 THEN RAISE EXCEPTION 'Reason required (>= 3 chars)' USING ERRCODE = 'check_violation'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.refund_number, r.order_id, r.total, r.tax_refunded INTO v_existing FROM refunds r WHERE r.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object('refund_id', v_existing.id, 'refund_number', v_existing.refund_number, 'order_id', v_existing.order_id,
        'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded, 'tenders', p_tenders, 'pts_deducted', 0, 'idempotent_replay', true);
    END IF;
  END IF;
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  IF v_order.status <> 'paid' THEN RAISE EXCEPTION 'Cannot refund % order', v_order.status USING ERRCODE = 'check_violation'; END IF;
  SELECT id INTO v_open_session FROM pos_sessions WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NULL THEN RAISE EXCEPTION 'No open session' USING ERRCODE = 'P0001'; END IF;
  IF v_order.session_id <> v_open_session THEN RAISE EXCEPTION 'Cross-shift refund not allowed in v1' USING ERRCODE = 'P0011'; END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 1 THEN RAISE EXCEPTION 'At least one line required' USING ERRCODE = 'check_violation'; END IF;

  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id := (v_line_entry->>'order_item_id')::UUID; v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);
    SELECT * INTO v_oi FROM order_items WHERE id = v_oi_id;
    IF v_oi.id IS NULL OR v_oi.order_id <> p_order_id THEN RAISE EXCEPTION 'Order item % not in order %', v_oi_id, p_order_id USING ERRCODE = 'check_violation'; END IF;
    IF v_oi.is_cancelled THEN RAISE EXCEPTION 'Cannot refund cancelled item %', v_oi_id USING ERRCODE = 'check_violation'; END IF;
    IF v_qty_req <= 0 OR v_qty_req > v_oi.quantity THEN RAISE EXCEPTION 'Invalid qty for item % (max %)', v_oi_id, v_oi.quantity USING ERRCODE = 'check_violation'; END IF;
    SELECT COALESCE(SUM(qty), 0) INTO v_qty_already FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id WHERE rl.order_item_id = v_oi_id;
    IF v_qty_already + v_qty_req > v_oi.quantity THEN RAISE EXCEPTION 'Refund qty (%) + already refunded (%) exceeds line qty (%) for item %', v_qty_req, v_qty_already, v_oi.quantity, v_oi_id USING ERRCODE = 'check_violation'; END IF;
    v_amount_line := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity); v_refund_total := v_refund_total + v_amount_line;
  END LOOP;

  -- Lot 6a : le mode taxe vit UNIQUEMENT dans _pb1_split_v1 (migration _171).
  -- Le split est fait ICI — avant le plafond et la validation des tenders — et
  -- pas a l'ancien emplacement de la formule : en mode exclusive les parts de
  -- lignes sont HT alors que le client a paye TTC ; le remboursement, le plafond
  -- (orders.total est TTC) et les tenders doivent tous porter sur le TTC.
  -- En mode inclusive : total inchange, meme taxe — comportement strictement constant.
  SELECT s.tax_amount, s.total
    INTO v_tax_refunded, v_refund_total
    FROM _pb1_split_v1(v_refund_total) s;

  SELECT COALESCE(SUM(total), 0) INTO v_prior_refunds FROM refunds WHERE order_id = p_order_id;
  IF v_prior_refunds + v_refund_total > v_order.total THEN RAISE EXCEPTION 'Refund total (% prior + % new) exceeds order total %', v_prior_refunds, v_refund_total, v_order.total USING ERRCODE = 'check_violation'; END IF;
  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) < 1 THEN RAISE EXCEPTION 'At least one tender required' USING ERRCODE = 'check_violation'; END IF;

  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    v_tender_method := (v_tender_entry->>'method')::payment_method; v_tender_amt := (v_tender_entry->>'amount')::DECIMAL(14,2);
    IF v_tender_amt <= 0 THEN RAISE EXCEPTION 'Tender amount must be > 0' USING ERRCODE = 'check_violation'; END IF;
    SELECT COALESCE(SUM(amount),0) INTO v_method_paid FROM order_payments WHERE order_id = p_order_id AND method = v_tender_method;
    SELECT COALESCE(SUM(rp.amount),0) INTO v_method_refunded FROM refund_payments rp JOIN refunds r ON r.id = rp.refund_id WHERE r.order_id = p_order_id AND rp.method = v_tender_method;
    IF v_method_refunded + v_tender_amt > v_method_paid THEN RAISE EXCEPTION 'Refund tender % (%) + prior (%) exceeds method paid (%)', v_tender_method, v_tender_amt, v_method_refunded, v_method_paid USING ERRCODE = 'check_violation'; END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
  END LOOP;
  IF v_tender_sum <> v_refund_total THEN RAISE EXCEPTION 'Sum of refund tenders (%) != refund total (%)', v_tender_sum, v_refund_total USING ERRCODE = 'check_violation'; END IF;

  INSERT INTO refund_sequences (date, last_number) VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE SET last_number = refund_sequences.last_number + 1 RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || LPAD(v_seq_number::TEXT, 4, '0');
  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void, idempotency_key)
  VALUES (v_refund_number, p_order_id, v_open_session, v_refund_total, v_tax_refunded, p_reason, v_profile_id, p_authorized_by, false, p_idempotency_key)
  RETURNING id INTO v_refund_id;

  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id := (v_line_entry->>'order_item_id')::UUID; v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);
    SELECT line_total, quantity, product_id, combo_components, modifier_ingredients_deducted INTO v_oi FROM order_items WHERE id = v_oi_id;
    v_amount_line := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity); v_product_id := v_oi.product_id;
    SELECT product_type INTO v_ptype FROM products WHERE id = v_product_id;
    INSERT INTO refund_lines (refund_id, order_item_id, qty, amount) VALUES (v_refund_id, v_oi_id, v_qty_req, v_amount_line);
    IF v_ptype = 'combo' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_oi.combo_components, '[]'::jsonb)) LOOP
        v_comp_qty := (v_comp->>'quantity')::NUMERIC * v_qty_req;
        INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
        SELECT (v_comp->>'product_id')::UUID, 'sale_void', v_comp_qty, COALESCE(p.unit, 'pcs'), 'refunds', v_refund_id, v_profile_id
        FROM products p WHERE p.id = (v_comp->>'product_id')::UUID;
        UPDATE products SET current_stock = current_stock + v_comp_qty, updated_at = now() WHERE id = (v_comp->>'product_id')::UUID;
        IF (SELECT is_display_item FROM products WHERE id = (v_comp->>'product_id')::UUID) THEN
          INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
            VALUES ((v_comp->>'product_id')::UUID, 'adjustment', v_comp_qty, 'Order refunded — combo display restore', 'order', p_order_id, v_profile_id);
          UPDATE display_stock SET quantity = quantity + v_comp_qty, updated_at = now() WHERE product_id = (v_comp->>'product_id')::UUID;
        END IF;
      END LOOP;
    ELSE
      INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
      SELECT v_product_id, 'sale_void', v_qty_req, COALESCE(p.unit, 'pcs'), 'refunds', v_refund_id, v_profile_id
      FROM products p WHERE p.id = v_product_id;
      UPDATE products SET current_stock = current_stock + v_qty_req, updated_at = now() WHERE id = v_product_id;
      IF (SELECT is_display_item FROM products WHERE id = v_product_id) THEN
        INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
          VALUES (v_product_id, 'adjustment', v_qty_req, 'Order refunded — display restore', 'order', p_order_id, v_profile_id);
        UPDATE display_stock SET quantity = quantity + v_qty_req, updated_at = now() WHERE product_id = v_product_id;
      END IF;
    END IF;

    -- Phase 2: restore the persisted modifier ingredients, scaled by the refunded
    -- fraction of the line (v_qty_req / v_oi.quantity).
    IF v_oi.modifier_ingredients_deducted IS NOT NULL THEN
      FOR v_ing IN SELECT * FROM jsonb_to_recordset(v_oi.modifier_ingredients_deducted)
        AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT) LOOP
        v_restore := v_ing.qty_base * v_qty_req / v_oi.quantity;
        INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
          VALUES (v_ing.product_id, 'sale_void', v_restore, COALESCE(v_ing.unit, 'pcs'), 'refunds', v_refund_id, v_profile_id);
        UPDATE products SET current_stock = current_stock + v_restore, updated_at = now() WHERE id = v_ing.product_id;
        IF (SELECT is_display_item FROM products WHERE id = v_ing.product_id) THEN
          INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
            VALUES (v_ing.product_id, 'adjustment', v_restore,
                    'Order refunded — modifier restore: ' || v_ing.group_name || ' / ' || v_ing.option_label, 'order', p_order_id, v_profile_id);
          UPDATE display_stock SET quantity = quantity + v_restore, updated_at = now() WHERE product_id = v_ing.product_id;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference)
    VALUES (v_refund_id, (v_tender_entry->>'method')::payment_method, (v_tender_entry->>'amount')::DECIMAL(14,2), NULLIF(v_tender_entry->>'reference',''));
  END LOOP;

  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 AND v_order.total > 0 THEN
    v_loyalty_ratio := v_refund_total::DECIMAL / v_order.total::DECIMAL;
    v_pts_to_deduct := FLOOR(v_order.loyalty_points_earned * v_loyalty_ratio);
    IF v_pts_to_deduct > 0 THEN
      UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - v_pts_to_deduct),
        lifetime_points = GREATEST(0, lifetime_points - v_pts_to_deduct), total_spent = GREATEST(0, total_spent - v_refund_total), updated_at = now()
      WHERE id = v_order.customer_id RETURNING loyalty_points INTO v_loyalty_now;
      INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points, points_balance_after, description, created_by)
      VALUES (v_order.customer_id, p_order_id, 'refund', -v_pts_to_deduct, v_loyalty_now, 'Refund ' || v_refund_number || ' on order ' || v_order.order_number, v_profile_id);
    END IF;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_authorized_by, 'order.refund', 'orders', p_order_id, jsonb_build_object(
    'refund_id', v_refund_id, 'refund_number', v_refund_number, 'order_number', v_order.order_number,
    'total_refunded', v_refund_total, 'tax_refunded', v_tax_refunded, 'reason', p_reason, 'authorized_by', p_authorized_by,
    'acting_cashier_id', v_profile_id, 'lines_count', jsonb_array_length(p_lines), 'tenders_count', jsonb_array_length(p_tenders), 'pts_deducted', v_pts_to_deduct));
  RETURN jsonb_build_object('refund_id', v_refund_id, 'refund_number', v_refund_number, 'order_id', p_order_id,
    'order_number', v_order.order_number, 'total_refunded', v_refund_total, 'tax_refunded', v_tax_refunded, 'tenders', p_tenders, 'pts_deducted', v_pts_to_deduct);
END $function$;

DROP FUNCTION IF EXISTS public.refund_order_rpc_v4(uuid, jsonb, jsonb, text, uuid, uuid, uuid);

REVOKE EXECUTE ON FUNCTION public.refund_order_rpc_v5(uuid, jsonb, jsonb, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_order_rpc_v5(uuid, jsonb, jsonb, text, uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refund_order_rpc_v5(uuid, jsonb, jsonb, text, uuid, uuid, uuid) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_order_rpc_v5(uuid, jsonb, jsonb, text, uuid, uuid, uuid) TO service_role;
