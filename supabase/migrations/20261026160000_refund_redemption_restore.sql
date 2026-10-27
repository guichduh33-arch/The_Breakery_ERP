-- Remboursement net et restitution proportionnelle des points utilisés.
-- Corps de départ live dev/rehearsal : MD5 LF 5191d34a69dded0e74935a318f969ad4.
ALTER TABLE public.refunds ADD COLUMN loyalty_points_restored integer NOT NULL DEFAULT 0 CHECK (loyalty_points_restored >= 0),
  ADD COLUMN loyalty_redemption_restored_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (loyalty_redemption_restored_amount >= 0);
ALTER TABLE public.refunds DROP CONSTRAINT refunds_total_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_total_check
  CHECK (total >= 0 AND (total > 0 OR loyalty_points_restored > 0));

CREATE OR REPLACE FUNCTION public.refund_order_rpc_v14(p_order_id uuid, p_lines jsonb, p_tenders jsonb, p_reason text, p_authorized_by uuid, p_idempotency_key uuid, p_acting_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID; v_profile_id UUID; v_order RECORD; v_open_session UUID; v_line_entry JSONB; v_oi_id UUID; v_oi RECORD;
  v_qty_req DECIMAL(14,3); v_qty_already DECIMAL(14,3); v_amount_line DECIMAL(14,2); v_refund_total DECIMAL(14,2) := 0;
  v_tax_refunded DECIMAL(14,2); v_prior_refunds DECIMAL(14,2); v_tender_entry JSONB;
  v_tender_method payment_method; v_tender_amt DECIMAL(14,2); v_tender_sum DECIMAL(14,2) := 0; v_method_paid DECIMAL(14,2);
  v_method_refunded DECIMAL(14,2); v_refund_id UUID; v_refund_number TEXT; v_seq_number INTEGER; v_loyalty_now INTEGER;
  v_pts_to_deduct INTEGER := 0; v_product_id UUID; v_existing RECORD;
  v_ptype TEXT; v_comp JSONB; v_comp_qty NUMERIC; v_ing RECORD; v_restore NUMERIC;
  v_sc_refund DECIMAL(14,2) := 0; v_sc_months INTEGER; v_sc_expires TIMESTAMPTZ; v_sc_ledger UUID; v_sc_balance_after NUMERIC;
  v_cross_shift BOOLEAN := false; v_refund_session UUID;
  v_result jsonb; v_replay_result jsonb;
  v_gross_total numeric; v_gross_prior numeric; v_gross_selected numeric;
  v_gross_cumulative numeric; v_all_returned boolean; v_prior_tax numeric;
  v_pts_prior integer := 0;
  v_redemption_restored numeric(14,2) := 0;
  v_pts_to_restore integer := 0; v_line_weight numeric := 0; v_line_allocated numeric := 0;
  v_cons RECORD; v_trk BOOLEAN; v_ded BOOLEAN; v_disp BOOLEAN; v_unit TEXT;
BEGIN
  v_user_id := p_acting_auth_user_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001'; END IF;
  IF p_authorized_by IS NULL THEN RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003'; END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.refund') THEN RAISE EXCEPTION 'Manager permission denied: pos.sale.refund' USING ERRCODE = 'P0003'; END IF;
  IF length(coalesce(p_reason,'')) < 3 THEN RAISE EXCEPTION 'Reason required (>= 3 chars)' USING ERRCODE = 'check_violation'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.refund_number, r.order_id, o.order_number, r.total, r.tax_refunded, COALESCE((SELECT (l.metadata->>'pts_restored')::integer
      FROM audit_logs l WHERE l.action='order.refund' AND l.metadata->>'refund_id'=r.id::text
      ORDER BY l.created_at LIMIT 1),0) AS pts_restored INTO v_existing FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
    SELECT l.metadata->'result' INTO v_replay_result FROM audit_logs l
      WHERE l.action='order.refund' AND l.metadata->>'refund_id'=v_existing.id::text
      ORDER BY l.created_at LIMIT 1;
    IF v_replay_result IS NOT NULL THEN RETURN v_replay_result || jsonb_build_object('idempotent_replay',true); END IF;
    RETURN jsonb_build_object('refund_id', v_existing.id, 'refund_number', v_existing.refund_number, 'order_id', v_existing.order_id, 'order_number', v_existing.order_number, 'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded, 'tenders', p_tenders, 'pts_deducted', 0, 'pts_restored', v_existing.pts_restored, 'idempotent_replay', true);
    END IF;
  END IF;
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.refund_number, r.order_id, o.order_number, r.total, r.tax_refunded, COALESCE((SELECT (l.metadata->>'pts_restored')::integer
      FROM audit_logs l WHERE l.action='order.refund' AND l.metadata->>'refund_id'=r.id::text
      ORDER BY l.created_at LIMIT 1),0) AS pts_restored INTO v_existing FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
    SELECT l.metadata->'result' INTO v_replay_result FROM audit_logs l
      WHERE l.action='order.refund' AND l.metadata->>'refund_id'=v_existing.id::text
      ORDER BY l.created_at LIMIT 1;
    IF v_replay_result IS NOT NULL THEN RETURN v_replay_result || jsonb_build_object('idempotent_replay',true); END IF;
    RETURN jsonb_build_object('refund_id', v_existing.id, 'refund_number', v_existing.refund_number, 'order_id', v_existing.order_id, 'order_number', v_existing.order_number, 'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded, 'tenders', p_tenders, 'pts_deducted', 0, 'pts_restored', v_existing.pts_restored, 'idempotent_replay', true);
    END IF;
  END IF;

  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  IF v_order.status NOT IN ('paid', 'completed') THEN RAISE EXCEPTION 'Cannot refund % order', v_order.status USING ERRCODE = 'check_violation'; END IF;
  SELECT id INTO v_open_session FROM pos_sessions WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NOT NULL AND v_order.session_id = v_open_session THEN
    v_refund_session := v_open_session;
  ELSE
    IF NOT has_permission_for_profile(v_profile_id, 'orders.refund') THEN
      RAISE EXCEPTION 'Cross-shift refund permission denied: orders.refund' USING ERRCODE = 'P0003';
    END IF;
    IF v_order.session_id IS NULL THEN
      RAISE EXCEPTION 'order has no session' USING ERRCODE = 'P0011';
    END IF;
    v_cross_shift := true;
    v_refund_session := v_order.session_id;
  END IF;
  IF v_order.loyalty_points_redeemed>0 AND v_order.customer_id IS NULL THEN
    RAISE EXCEPTION 'Redemption refund requires a customer' USING ERRCODE='check_violation';
  END IF;
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
  SELECT COALESCE(SUM(total),0),COALESCE(SUM(tax_refunded),0)
    INTO v_prior_refunds,v_prior_tax FROM refunds WHERE order_id=p_order_id;
  IF v_order.loyalty_points_redeemed > 0 THEN
    -- La base de répartition est le prix payé des lignes ; un cadeau reste à zéro.
    SELECT COALESCE(SUM(line_total),0) INTO v_gross_total
      FROM order_items WHERE order_id=p_order_id AND NOT is_cancelled;
    SELECT COALESCE(SUM(oi.line_total * rl.qty / oi.quantity),0) INTO v_gross_prior
      FROM refund_lines rl JOIN refunds r ON r.id=rl.refund_id
      JOIN order_items oi ON oi.id=rl.order_item_id
      WHERE r.order_id=p_order_id AND NOT oi.is_cancelled;
    SELECT COALESCE(SUM(oi.line_total * (ln->>'qty')::numeric(14,3) / oi.quantity),0)
      INTO v_gross_selected FROM jsonb_array_elements(p_lines) ln
      JOIN order_items oi ON oi.id=(ln->>'order_item_id')::uuid;
    SELECT NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=p_order_id
      AND NOT oi.is_cancelled AND oi.line_total>0 AND oi.quantity >
        COALESCE((SELECT SUM(rl.qty) FROM refund_lines rl JOIN refunds r ON r.id=rl.refund_id
          WHERE r.order_id=p_order_id AND rl.order_item_id=oi.id),0)
        + COALESCE((SELECT SUM((ln->>'qty')::numeric(14,3)) FROM jsonb_array_elements(p_lines) ln
          WHERE (ln->>'order_item_id')::uuid=oi.id),0)) INTO v_all_returned;
    IF v_gross_total<=0 OR v_gross_selected<=0 THEN
      RAISE EXCEPTION 'Invalid redemption refund allocation' USING ERRCODE='check_violation';
    END IF;
    v_gross_cumulative:=LEAST(v_gross_total,v_gross_prior+v_gross_selected);
    IF v_all_returned THEN v_gross_cumulative:=v_gross_total; END IF;
    v_refund_total:=GREATEST(0,LEAST(v_order.total,CASE WHEN v_all_returned
      THEN v_order.total ELSE round_idr(v_order.total*v_gross_cumulative/v_gross_total) END)-v_prior_refunds);
    v_tax_refunded:=GREATEST(0,LEAST(v_order.tax_amount,CASE WHEN v_all_returned
      THEN v_order.tax_amount ELSE round_idr(v_order.tax_amount*v_gross_cumulative/v_gross_total) END)-v_prior_tax);
    v_pts_to_restore:=FLOOR(v_order.loyalty_points_redeemed*v_gross_cumulative/v_gross_total)
      - FLOOR(v_order.loyalty_points_redeemed*v_gross_prior/v_gross_total);
    v_redemption_restored:=round(v_order.loyalty_redemption_amount
      * FLOOR(v_order.loyalty_points_redeemed*v_gross_cumulative/v_gross_total)/v_order.loyalty_points_redeemed,2)
      - round(v_order.loyalty_redemption_amount
      * FLOOR(v_order.loyalty_points_redeemed*v_gross_prior/v_gross_total)/v_order.loyalty_points_redeemed,2);
  ELSE
    SELECT s.tax_amount,s.total INTO v_tax_refunded,v_refund_total FROM _pb1_split_v1(v_refund_total) s;
  END IF;
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned>0 AND v_order.total>0 THEN
    SELECT COALESCE(SUM(-points),0) INTO v_pts_prior FROM loyalty_transactions
      WHERE order_id=p_order_id AND transaction_type='refund' AND points<0;
    v_pts_to_deduct:=GREATEST(0,LEAST(v_order.loyalty_points_earned,
      FLOOR(v_order.loyalty_points_earned*(v_prior_refunds+v_refund_total)/v_order.total))-v_pts_prior);
  END IF;
  IF v_prior_refunds + v_refund_total > v_order.total THEN RAISE EXCEPTION 'Refund total (% prior + % new) exceeds order total %', v_prior_refunds, v_refund_total, v_order.total USING ERRCODE = 'check_violation'; END IF;
  IF v_refund_total=0 AND v_pts_to_restore<=0 THEN
    RAISE EXCEPTION 'Select more quantity: no money or points to restore' USING ERRCODE='check_violation';
  END IF;
  IF p_tenders IS NULL OR (v_refund_total>0 AND jsonb_array_length(p_tenders)<1) THEN
    RAISE EXCEPTION 'At least one tender required' USING ERRCODE='check_violation';
  END IF;
  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    v_tender_method := (v_tender_entry->>'method')::payment_method; v_tender_amt := (v_tender_entry->>'amount')::DECIMAL(14,2);
    IF v_tender_amt <= 0 THEN RAISE EXCEPTION 'Tender amount must be > 0' USING ERRCODE = 'check_violation'; END IF;
    IF v_cross_shift AND v_tender_method = 'cash' THEN RAISE EXCEPTION 'cash_refund_requires_open_session' USING ERRCODE = 'P0016'; END IF;
    IF v_tender_method = 'store_credit' THEN
      IF v_order.customer_id IS NULL THEN
        RAISE EXCEPTION 'Store credit refund requires a customer on the order' USING ERRCODE = 'P0015';
      END IF;
      v_sc_refund := v_sc_refund + v_tender_amt;
    ELSE
      SELECT COALESCE(SUM(amount),0) INTO v_method_paid FROM order_payments WHERE order_id = p_order_id AND method = v_tender_method;
      SELECT COALESCE(SUM(rp.amount),0) INTO v_method_refunded FROM refund_payments rp JOIN refunds r ON r.id = rp.refund_id WHERE r.order_id = p_order_id AND rp.method = v_tender_method;
      IF v_method_refunded + v_tender_amt > v_method_paid THEN RAISE EXCEPTION 'Refund tender % (%) + prior (%) exceeds method paid (%)', v_tender_method, v_tender_amt, v_method_refunded, v_method_paid USING ERRCODE = 'check_violation'; END IF;
    END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
  END LOOP;
  IF v_tender_sum <> v_refund_total THEN RAISE EXCEPTION 'Sum of refund tenders (%) != refund total (%)', v_tender_sum, v_refund_total USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO refund_sequences (date, last_number) VALUES (CURRENT_DATE, 1) ON CONFLICT (date) DO UPDATE SET last_number = refund_sequences.last_number + 1 RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || LPAD(v_seq_number::TEXT, 4, '0');

  BEGIN
    INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void, idempotency_key, loyalty_points_restored, loyalty_redemption_restored_amount) VALUES (v_refund_number, p_order_id, v_refund_session, v_refund_total, v_tax_refunded, p_reason, v_profile_id, p_authorized_by, false, p_idempotency_key, v_pts_to_restore, v_redemption_restored) RETURNING id INTO v_refund_id;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NULL THEN RAISE; END IF;
    SELECT r.id, r.refund_number, r.order_id, o.order_number, r.total, r.tax_refunded, COALESCE((SELECT (l.metadata->>'pts_restored')::integer
      FROM audit_logs l WHERE l.action='order.refund' AND l.metadata->>'refund_id'=r.id::text
      ORDER BY l.created_at LIMIT 1),0) AS pts_restored INTO v_existing FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NULL THEN RAISE; END IF;
    RETURN jsonb_build_object('refund_id', v_existing.id, 'refund_number', v_existing.refund_number, 'order_id', v_existing.order_id, 'order_number', v_existing.order_number, 'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded, 'tenders', p_tenders, 'pts_deducted', 0, 'pts_restored', v_existing.pts_restored, 'idempotent_replay', true);
  END;

  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id := (v_line_entry->>'order_item_id')::UUID; v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);
    SELECT line_total, quantity, product_id, combo_components, modifier_ingredients_deducted INTO v_oi FROM order_items WHERE id = v_oi_id;
    v_amount_line := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity); v_product_id := v_oi.product_id;
    IF v_order.loyalty_points_redeemed>0 THEN
      v_line_weight:=v_line_weight+v_oi.line_total*v_qty_req/v_oi.quantity;
      v_amount_line:=LEAST(v_refund_total,CASE WHEN v_line_weight>=v_gross_selected
        THEN v_refund_total ELSE round_idr(v_refund_total*v_line_weight/v_gross_selected) END)-v_line_allocated;
      v_line_allocated:=v_line_allocated+v_amount_line;
    END IF;
    SELECT product_type, unit, COALESCE(is_display_item, false), COALESCE(track_inventory, true), COALESCE(deduct_stock, false)
      INTO v_ptype, v_unit, v_disp, v_trk, v_ded
      FROM products WHERE id = v_product_id;
    INSERT INTO refund_lines (refund_id, order_item_id, qty, amount) VALUES (v_refund_id, v_oi_id, v_qty_req, v_amount_line);
    IF v_ptype = 'combo' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_oi.combo_components, '[]'::jsonb)) LOOP
        v_comp_qty := (v_comp->>'quantity')::NUMERIC * v_qty_req;
        PERFORM _restore_sale_stock_v1(
          p_product_id           := (v_comp->>'product_id')::UUID,
          p_quantity             := v_comp_qty,
          p_reference_id         := v_refund_id,
          p_created_by           := v_profile_id,
          p_reason               := 'Order refunded — combo display restore',
          p_reference_type       := 'refunds',
          p_display_reference_id := p_order_id
        );
      END LOOP;
    ELSE
      IF v_disp OR v_trk THEN
        PERFORM _restore_sale_stock_v1(
          p_product_id           := v_product_id,
          p_quantity             := v_qty_req,
          p_reference_id         := v_refund_id,
          p_created_by           := v_profile_id,
          p_reason               := 'Order refunded — display restore',
          p_reference_type       := 'refunds',
          p_unit                 := v_unit,
          p_display_reference_id := p_order_id
        );
      ELSIF v_ded THEN
        FOR v_cons IN SELECT * FROM _resolve_order_recipe_restoration_v1(p_order_id, v_product_id, v_qty_req) LOOP
          PERFORM _restore_sale_stock_v1(
            p_product_id           := v_cons.product_id,
            p_quantity             := v_cons.qty_base,
            p_reference_id         := v_refund_id,
            p_created_by           := v_profile_id,
            p_reason               := 'Order refunded — recipe restore',
            p_reference_type       := 'refunds',
            p_unit                 := v_cons.unit,
            p_display_reference_id := p_order_id
          );
        END LOOP;
      END IF;
    END IF;
    IF v_oi.modifier_ingredients_deducted IS NOT NULL THEN
      FOR v_ing IN SELECT * FROM jsonb_to_recordset(v_oi.modifier_ingredients_deducted) AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT) LOOP
        v_restore := v_ing.qty_base * v_qty_req / v_oi.quantity;
        PERFORM _restore_sale_stock_v1(
          p_product_id           := v_ing.product_id,
          p_quantity             := v_restore,
          p_reference_id         := v_refund_id,
          p_created_by           := v_profile_id,
          p_reason               := 'Order refunded — modifier restore: ' || v_ing.group_name || ' / ' || v_ing.option_label,
          p_reference_type       := 'refunds',
          p_unit                 := COALESCE(v_ing.unit, 'pcs'),
          p_display_reference_id := p_order_id
        );
      END LOOP;
    END IF;
  END LOOP;
  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference) VALUES (v_refund_id, (v_tender_entry->>'method')::payment_method, (v_tender_entry->>'amount')::DECIMAL(14,2), NULLIF(v_tender_entry->>'reference',''));
  END LOOP;
  IF v_sc_refund > 0 THEN
    PERFORM 1 FROM customers WHERE id = v_order.customer_id FOR UPDATE;
    SELECT store_credit_expiry_months INTO v_sc_months FROM business_config WHERE id = 1;
    IF COALESCE(v_sc_months, 0) > 0 THEN
      v_sc_expires := now() + make_interval(months => v_sc_months);
    END IF;
    SELECT a.ledger_id, a.balance_after INTO v_sc_ledger, v_sc_balance_after
      FROM _apply_store_credit_v1(v_order.customer_id, v_sc_refund, 'refund',
             'refunds', v_refund_id, v_sc_expires, v_profile_id, NULL) a;
  END IF;
  -- Ordre des verrous des ventes cash : stock puis client. Tout refus annule le reversal.
  IF v_order.customer_id IS NOT NULL THEN
    SELECT loyalty_points INTO v_loyalty_now FROM customers WHERE id=v_order.customer_id FOR UPDATE;
    IF v_loyalty_now+v_pts_to_restore<v_pts_to_deduct THEN
      RAISE EXCEPTION 'loyalty_points_unavailable' USING ERRCODE='P0020';
    END IF;
  END IF;
  -- La restitution précède la reprise : elle peut couvrir les points à reprendre.
  IF v_pts_to_restore>0 THEN
    UPDATE customers SET loyalty_points=loyalty_points+v_pts_to_restore,updated_at=now()
      WHERE id=v_order.customer_id RETURNING loyalty_points INTO v_loyalty_now;
    INSERT INTO loyalty_transactions(customer_id,order_id,transaction_type,points,points_balance_after,description,created_by)
      VALUES(v_order.customer_id,p_order_id,'refund',v_pts_to_restore,v_loyalty_now,
        'Restored redemption: refund '||v_refund_number,v_profile_id);
  END IF;
  IF v_pts_to_deduct>0 THEN
    UPDATE customers SET loyalty_points=loyalty_points-v_pts_to_deduct,
      lifetime_points=GREATEST(0,lifetime_points-v_pts_to_deduct),updated_at=now()
      WHERE id=v_order.customer_id RETURNING loyalty_points INTO v_loyalty_now;
    INSERT INTO loyalty_transactions(customer_id,order_id,transaction_type,points,points_balance_after,description,created_by)
      VALUES(v_order.customer_id,p_order_id,'refund',-v_pts_to_deduct,v_loyalty_now,
        'Refund '||v_refund_number||' on order '||v_order.order_number,v_profile_id);
  END IF;
  IF v_order.customer_id IS NOT NULL THEN
    UPDATE customers SET total_spent=GREATEST(0,total_spent-v_refund_total),updated_at=now()
      WHERE id=v_order.customer_id;
  END IF;
  v_result := jsonb_build_object('refund_id', v_refund_id, 'refund_number', v_refund_number, 'order_id', p_order_id, 'order_number', v_order.order_number, 'total_refunded', v_refund_total, 'tax_refunded', v_tax_refunded, 'tenders', p_tenders, 'pts_deducted', v_pts_to_deduct, 'pts_restored', v_pts_to_restore, 'store_credit_refunded', v_sc_refund, 'store_credit_balance_after', v_sc_balance_after);
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES (p_authorized_by, 'order.refund', 'orders', p_order_id, jsonb_build_object('refund_id', v_refund_id, 'refund_number', v_refund_number, 'order_number', v_order.order_number, 'total_refunded', v_refund_total, 'tax_refunded', v_tax_refunded, 'reason', p_reason, 'authorized_by', p_authorized_by, 'acting_cashier_id', v_profile_id, 'lines_count', jsonb_array_length(p_lines), 'tenders_count', jsonb_array_length(p_tenders), 'pts_deducted', v_pts_to_deduct, 'pts_restored', v_pts_to_restore, 'rpc_version', 'v14-redemption-refund', 'result', v_result));
  RETURN v_result;
END $function$
;
DROP FUNCTION public.refund_order_rpc_v13(uuid,jsonb,jsonb,text,uuid,uuid,uuid);
REVOKE ALL ON FUNCTION public.refund_order_rpc_v14(uuid,jsonb,jsonb,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refund_order_rpc_v14(uuid,jsonb,jsonb,text,uuid,uuid,uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Trigger comptable depuis pg_get_functiondef live (MD5 c66bcf8de9856b4e5ea2911b0a87f8ae).
CREATE OR REPLACE FUNCTION public.fn_create_je_for_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_je_id        UUID;
  v_existing     UUID;
  v_entry_no     TEXT;
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_net          DECIMAL(14,2);
  v_pay          RECORD;
  v_order_number TEXT;
  v_tender_acc   UUID;
BEGIN
  -- D2 : refund de void -> la contre-passation est le JE 'sale_void' emis par
  -- create_sale_journal_entry. Ne pas produire de second JE 'sale_refund'.
  IF NEW.is_full_void THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'sale_refund' AND reference_id = NEW.id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_net := NEW.total - NEW.tax_refunded;
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  SELECT order_number INTO v_order_number FROM orders WHERE id = NEW.order_id;

  v_entry_no := next_journal_entry_number(NEW.created_at::date);

  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)
  VALUES (v_entry_no, NEW.created_at::date,
          'Refund ' || NEW.refund_number || ' (order ' || COALESCE(v_order_number, '?') || ')',
          'sale_refund', NEW.id, 'posted', GREATEST(NEW.total,NEW.tax_refunded), GREATEST(NEW.total,NEW.tax_refunded), NEW.refunded_by)
  RETURNING id INTO v_je_id;

  IF v_net>0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id,account_id,debit,credit,description)
      VALUES(v_je_id,v_sales_id,v_net,0,'Sales revenue (refund)');
  ELSIF v_net<0 THEN
    -- Les arrondis cumulés peuvent reclasser la taxe sans nouveau tender.
    INSERT INTO journal_entry_lines (journal_entry_id,account_id,debit,credit,description)
      VALUES(v_je_id,v_sales_id,0,-v_net,'Sales revenue (refund tax rounding)');
  END IF;
  IF NEW.tax_refunded>0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id,account_id,debit,credit,description)
      VALUES(v_je_id,v_pb1_id,NEW.tax_refunded,0,'PB1 payable (refund)');
  END IF;

  FOR v_pay IN SELECT method, amount FROM refund_payments WHERE refund_id = NEW.id LOOP
    -- D3 : mapping partagé vente/reversal (store_credit -> 2220 depuis le Lot 4).
    v_tender_acc := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method::TEXT));
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_tender_acc, 0, v_pay.amount,
      CASE WHEN v_pay.method = 'store_credit'
           THEN 'Store credit issued (refund)'
           ELSE 'Cash refund (' || v_pay.method::TEXT || ')' END);
  END LOOP;

  IF NEW.total>0 AND NOT EXISTS (SELECT 1 FROM refund_payments WHERE refund_id = NEW.id) THEN
    v_tender_acc := resolve_mapping_account('SALE_PAYMENT_CASH');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_tender_acc, 0, NEW.total, 'Cash refund (fallback -- no tender recorded)');
  END IF;

  IF NEW.loyalty_redemption_restored_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id,account_id,debit,credit,description) VALUES
      (v_je_id,resolve_mapping_account('SALE_DISCOUNT'),NEW.loyalty_redemption_restored_amount,0,'Loyalty redemption restored -- DR discount'),
      (v_je_id,resolve_mapping_account('LOYALTY_LIABILITY'),0,NEW.loyalty_redemption_restored_amount,'Loyalty redemption restored -- CR liability');
    UPDATE journal_entries SET total_debit=total_debit+NEW.loyalty_redemption_restored_amount,
      total_credit=total_credit+NEW.loyalty_redemption_restored_amount WHERE id=v_je_id;
  END IF;

  RETURN NEW;
END $function$
;
