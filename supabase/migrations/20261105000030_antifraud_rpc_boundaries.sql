-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.edit_b2b_order_v3(p_order_id uuid, p_items jsonb, p_notes text, p_expected_updated_at timestamp with time zone, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_uid uuid := auth.uid();
 v_actor uuid;
 v_customer uuid;
 v_order public.orders%ROWTYPE;
 v_existing public.b2b_order_edit_keys%ROWTYPE;
 v_request jsonb;
 v_before jsonb;
 v_old_notes text;
 v_after jsonb;
 v_lines jsonb := '[]'::jsonb;
 v_line record;
 v_item public.order_items%ROWTYPE;
 v_product public.products%ROWTYPE;
 v_stock record;
 v_cons record;
 v_quantity numeric;
 v_price numeric;
 v_total numeric(14,2) := 0;
 v_delta numeric(14,2);
 v_balance numeric(14,2);
 v_credit jsonb;
 v_je uuid;
 v_ar uuid;
 v_revenue uuid;
 v_result jsonb;
 v_allow_negative boolean;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
 IF NOT public.has_permission(v_uid,'b2b.read') OR NOT public.has_permission(v_uid,'b2b.order.create') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003';
 END IF;
 SELECT id INTO v_actor FROM public.user_profiles WHERE auth_user_id=v_uid AND deleted_at IS NULL;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE='P0001'; END IF;
 IF p_idempotency_key IS NULL OR p_expected_updated_at IS NULL THEN
  RAISE EXCEPTION 'edit_revision_and_key_required' USING ERRCODE='P0001';
 END IF;
 v_request := jsonb_build_object('order_id',p_order_id,'items',p_items,'notes',p_notes,'revision',p_expected_updated_at);
 PERFORM pg_advisory_xact_lock(hashtextextended('b2b-edit:'||p_idempotency_key::text,0));
 SELECT * INTO v_existing FROM public.b2b_order_edit_keys WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_existing.actor_id<>v_actor OR v_existing.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE='P0001';
  END IF;
  RETURN v_existing.result || jsonb_build_object('idempotent_replay',true);
 END IF;

 -- Même ordre de verrous que le règlement : client puis facture.
 SELECT customer_id INTO v_customer FROM public.orders WHERE id=p_order_id AND order_type='b2b';
 IF v_customer IS NULL THEN RAISE EXCEPTION 'b2b_order_not_found' USING ERRCODE='P0002'; END IF;
 SELECT b2b_current_balance INTO v_balance FROM public.customers
  WHERE id=v_customer AND customer_type='b2b' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 v_old_notes := v_order.notes;
 IF v_order.customer_id IS DISTINCT FROM v_customer OR v_order.status<>'b2b_pending'
    OR v_order.b2b_delivered_at IS NOT NULL OR v_order.paid_at IS NOT NULL THEN
  RAISE EXCEPTION 'order_not_editable' USING ERRCODE='P0001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.b2b_payment_allocations WHERE invoice_id=p_order_id)
    OR EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=p_order_id)
    OR EXISTS(SELECT 1 FROM public.refunds WHERE order_id=p_order_id) THEN
  RAISE EXCEPTION 'order_has_payments' USING ERRCODE='P0011';
 END IF;
 IF v_order.financial_import_document_id IS NOT NULL OR (to_jsonb(v_order)->>'outstanding_at') IS NOT NULL THEN
  RAISE EXCEPTION 'order_requires_dedicated_workflow' USING ERRCODE='P0001';
 END IF;
 IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'order_changed_reload' USING ERRCODE='P0001';
 END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN
  RAISE EXCEPTION 'items_required' USING ERRCODE='P0001';
 END IF;
 IF jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>500 OR length(coalesce(p_notes,''))>10000 THEN
  RAISE EXCEPTION 'invalid_edit_payload' USING ERRCODE='P0001';
 END IF;
 PERFORM public.check_fiscal_period_open(current_date);
 PERFORM id FROM public.order_items WHERE order_id=p_order_id FOR UPDATE;
 -- Le parcours B2B standard ne comporte ni remise, ni combo, ni envoi cuisine.
 IF v_order.tax_amount<>0 OR coalesce(v_order.discount_amount,0)<>0 OR coalesce(v_order.promotion_total,0)<>0
    OR EXISTS(SELECT 1 FROM public.order_items WHERE order_id=p_order_id AND (
      is_cancelled OR is_locked OR sent_to_kitchen_at IS NOT NULL OR kitchen_status<>'pending'
      OR coalesce(modifiers,'[]'::jsonb)<>'[]'::jsonb OR combo_components IS NOT NULL
      OR coalesce(discount_amount,0)<>0 OR is_promo_gift)) THEN
  RAISE EXCEPTION 'order_requires_dedicated_workflow' USING ERRCODE='P0001';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(oi) ORDER BY oi.id),'[]'::jsonb) INTO v_before
  FROM public.order_items oi WHERE order_id=p_order_id;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) AS x(id uuid,product_id uuid,quantity numeric)
   WHERE quantity IS NULL OR quantity<=0 OR quantity::text IN ('NaN','Infinity','-Infinity')
      OR quantity<>round(quantity,3) OR quantity>9999999.999 OR product_id IS NULL)
   OR EXISTS(SELECT id FROM jsonb_to_recordset(p_items) AS x(id uuid) WHERE id IS NOT NULL GROUP BY id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'invalid_quantity_or_item' USING ERRCODE='P0001';
 END IF;
 FOR v_line IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id uuid,product_id uuid,quantity numeric) LOOP
  SELECT * INTO v_product FROM public.products WHERE id=v_line.product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;
  IF v_line.id IS NOT NULL THEN
   SELECT * INTO v_item FROM public.order_items WHERE id=v_line.id AND order_id=p_order_id;
   IF NOT FOUND OR v_item.product_id<>v_line.product_id THEN
    RAISE EXCEPTION 'invalid_order_item' USING ERRCODE='P0001';
   END IF;
   -- Une quantité modifiée conserve le tarif déjà convenu sur la ligne.
   v_price := v_item.unit_price;
  ELSE
   IF NOT v_product.is_active OR v_product.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'product_not_available' USING ERRCODE='P0002';
   END IF;
   v_price := public._resolve_b2b_line_price_v1(v_customer,v_line.product_id);
  END IF;
  IF v_price IS NULL OR v_price<0 THEN RAISE EXCEPTION 'price_unresolved' USING ERRCODE='P0002'; END IF;
  v_quantity := v_line.quantity;
  v_total := v_total + public.round_idr(v_price*v_quantity);
  v_lines := v_lines || jsonb_build_object('id',coalesce(v_line.id,gen_random_uuid()),
   'product_id',v_line.product_id,'quantity',v_quantity,'unit_price',v_price,
   'line_total',public.round_idr(v_price*v_quantity),'name_snapshot',coalesce(v_item.name_snapshot,v_product.name));
  v_item := NULL;
 END LOOP;
 IF v_total<=0 THEN RAISE EXCEPTION 'invalid_total' USING ERRCODE='P0001'; END IF;
 v_delta := v_total-v_order.total;
 IF v_delta>0 THEN
  v_credit := public.validate_b2b_credit_limit_v1(v_customer,v_delta);
  IF NOT (v_credit->>'allowed')::boolean THEN
   RAISE EXCEPTION 'credit_limit_exceeded' USING ERRCODE='P0011';
  END IF;
 END IF;
 IF v_balance+v_delta<0 THEN RAISE EXCEPTION 'balance_underflow' USING ERRCODE='P0011'; END IF;
 v_allow_negative := coalesce((SELECT allow_negative_stock FROM public.business_config LIMIT 1),true);

 -- Les restitutions précèdent les déductions ; seules les différences de quantité bougent.
 FOR v_stock IN
  WITH changes AS (
   SELECT product_id,-quantity AS qty FROM public.order_items WHERE order_id=p_order_id
   UNION ALL SELECT product_id,quantity FROM jsonb_to_recordset(v_lines) AS x(product_id uuid,quantity numeric)
  ) SELECT product_id,sum(qty) AS qty FROM changes GROUP BY product_id HAVING sum(qty)<>0 ORDER BY sum(qty),product_id
 LOOP
  SELECT * INTO v_product FROM public.products WHERE id=v_stock.product_id FOR UPDATE;
  IF v_product.track_inventory THEN
   IF v_stock.qty<0 THEN
    PERFORM public._restore_sale_stock_v1(v_product.id,-v_stock.qty,p_order_id,v_actor,'B2B order edit');
   ELSE
    PERFORM public._record_sale_stock_v1(v_product.id,v_stock.qty,p_order_id,v_actor,'B2B order edit',p_allow_negative:=v_allow_negative);
   END IF;
  ELSIF v_product.deduct_stock THEN
   FOR v_cons IN SELECT * FROM public._resolve_order_recipe_restoration_v1(p_order_id,v_product.id,abs(v_stock.qty)) LOOP
    IF v_stock.qty<0 THEN
     PERFORM public._restore_sale_stock_v1(v_cons.product_id,v_cons.qty_base,p_order_id,v_actor,'B2B order edit — recipe',p_unit:=v_cons.unit);
    ELSE
     PERFORM public._record_sale_stock_v1(v_cons.product_id,v_cons.qty_base,p_order_id,v_actor,'B2B order edit — recipe',p_unit:=v_cons.unit,p_allow_negative:=v_allow_negative);
    END IF;
   END LOOP;
  END IF;
 END LOOP;
 DELETE FROM public.order_items oi WHERE order_id=p_order_id
  AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(id uuid) WHERE x.id=oi.id);
 FOR v_line IN SELECT * FROM jsonb_to_recordset(v_lines)
  AS x(id uuid,product_id uuid,quantity numeric,unit_price numeric,line_total numeric,name_snapshot text) LOOP
  UPDATE public.order_items SET quantity=v_line.quantity,line_total=v_line.line_total WHERE id=v_line.id AND order_id=p_order_id;
  IF NOT FOUND THEN
   INSERT INTO public.order_items(id,order_id,product_id,name_snapshot,quantity,unit_price,line_total)
    VALUES(v_line.id,p_order_id,v_line.product_id,v_line.name_snapshot,v_line.quantity,v_line.unit_price,v_line.line_total);
  END IF;
 END LOOP;
 IF v_delta<>0 THEN
  v_ar := public.resolve_mapping_account('B2B_AR');
  v_revenue := public.resolve_mapping_account('SALE_B2B_REVENUE');
  INSERT INTO public.journal_entries(entry_number,entry_date,description,reference_type,reference_id,
   status,total_debit,total_credit,created_by,metadata)
  VALUES(public.next_journal_entry_number(current_date),current_date,'B2B order edit '||v_order.order_number,
   'b2b_order',p_order_id,'posted',abs(v_delta),abs(v_delta),v_actor,
   jsonb_build_object('movement_type','b2b_edit:'||p_idempotency_key::text)) RETURNING id INTO v_je;
  INSERT INTO public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description) VALUES
   (v_je,v_ar,greatest(v_delta,0),greatest(-v_delta,0),'B2B edit — AR'),
   (v_je,v_revenue,greatest(-v_delta,0),greatest(v_delta,0),'B2B edit — revenue');
  UPDATE public.customers SET b2b_current_balance=v_balance+v_delta,updated_at=now() WHERE id=v_customer;
 END IF;
 UPDATE public.orders SET subtotal=v_total,total=v_total,notes=nullif(trim(p_notes),''),updated_at=now()
  WHERE id=p_order_id RETURNING * INTO v_order;
 SELECT jsonb_agg(to_jsonb(oi) ORDER BY oi.id) INTO v_after FROM public.order_items oi WHERE order_id=p_order_id;
 v_result := jsonb_build_object('order_id',p_order_id,'total',v_total,'updated_at',v_order.updated_at,
  'idempotency_key',p_idempotency_key,'idempotent_replay',false);
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_actor,'b2b.order.edited','orders',p_order_id,
  jsonb_build_object('idempotency_key',p_idempotency_key,'je_id',v_je,'total_delta',v_delta),
  jsonb_build_object('before',jsonb_build_object('items',v_before,'notes',v_old_notes),
   'after',jsonb_build_object('items',v_after,'notes',nullif(trim(p_notes),''))));
 INSERT INTO public.b2b_order_edit_keys(idempotency_key,order_id,actor_id,request,result)
  VALUES(p_idempotency_key,p_order_id,v_actor,v_request,v_result);
 RETURN v_result;
EXCEPTION WHEN unique_violation THEN
 SELECT * INTO v_existing FROM public.b2b_order_edit_keys WHERE idempotency_key=p_idempotency_key;
 IF NOT FOUND OR v_existing.actor_id<>v_actor OR v_existing.request<>v_request THEN RAISE; END IF;
 RETURN v_existing.result || jsonb_build_object('idempotent_replay',true);
WHEN OTHERS THEN
 -- Ne pas exposer le stock confidentiel par un message de rejet.
 IF SQLSTATE='P0002' AND SQLERRM ~* '(insufficient.*stock|have )' THEN
  RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
 END IF;
 RAISE;
END;
$function$
;
REVOKE ALL ON FUNCTION public.edit_b2b_order_v3(p_order_id uuid, p_items jsonb, p_notes text, p_expected_updated_at timestamp with time zone, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_b2b_order_v3(p_order_id uuid, p_items jsonb, p_notes text, p_expected_updated_at timestamp with time zone, p_idempotency_key uuid) TO authenticated,service_role;
DROP FUNCTION public.edit_b2b_order_v2(p_order_id uuid, p_items jsonb, p_notes text, p_expected_updated_at timestamp with time zone, p_idempotency_key uuid);

CREATE OR REPLACE FUNCTION public._dashboard_kpis_v3(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  WITH ref_days AS (
    SELECT p_today AS day, 'today' AS slot
    UNION ALL SELECT p_today - 1, 'yesterday'
    UNION ALL SELECT p_today - 7, 'd7'
  ),
  valid AS (
    SELECT ((o.recognized_at AT TIME ZONE p_tz))::date AS day, o.id, o.total, o.customer_id
      FROM reporting_private.recognized_sales_v2 o
     WHERE TRUE
       AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 1, p_today - 7)
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE p_tz))::date AS day, SUM(r.total) AS refunds
      FROM reporting_private.closed_refunds_v1 r
     WHERE ((r.created_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 1, p_today - 7)
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  day_items AS (
    SELECT v.day,
           SUM(oi.quantity)                             AS qty,
           SUM(oi.quantity * COALESCE(p.cost_price, 0)) AS cogs,
           SUM(oi.line_total)                           AS line_rev,
           SUM(oi.line_total) FILTER (
             WHERE p.cost_price IS NOT NULL AND p.cost_price > 0)  AS costed_rev
      FROM reporting_private.closed_order_items_v1 oi
      JOIN valid v         ON v.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE NOT oi.is_cancelled
     GROUP BY v.day
  ),
  metrics AS (
    SELECT rd.slot,
           COALESCE(SUM(v.total), 0)                                AS gross,
           COALESCE(SUM(v.total), 0) - COALESCE(MAX(dr.refunds), 0) AS net,
           COUNT(v.id)                                              AS order_count,
           COUNT(DISTINCT v.customer_id)                            AS customer_count,
           COALESCE(MAX(di.qty), 0)                                 AS items,
           COALESCE(MAX(di.cogs), 0)                                AS cogs,
           COALESCE(MAX(di.line_rev), 0)                            AS line_rev,
           COALESCE(MAX(di.costed_rev), 0)                          AS costed_rev
      FROM ref_days rd
      LEFT JOIN valid       v  ON v.day  = rd.day
      LEFT JOIN day_refunds dr ON dr.day = rd.day
      LEFT JOIN day_items   di ON di.day = rd.day
     GROUP BY rd.slot
  ),
  s AS (
    SELECT slot, net, order_count, customer_count, items,
           CASE WHEN order_count = 0 THEN 0 ELSE ROUND(gross / order_count, 2) END AS basket,
           CASE WHEN net <= 0 THEN NULL ELSE ROUND(((net - cogs) / net) * 100, 2) END AS margin,
           CASE WHEN line_rev <= 0 THEN NULL
                ELSE ROUND((costed_rev / line_rev) * 100, 2) END AS coverage
      FROM metrics
  ),
  p AS (
    SELECT
      (SELECT net            FROM s WHERE slot = 'today')     AS net_t,
      (SELECT net            FROM s WHERE slot = 'yesterday') AS net_y,
      (SELECT net            FROM s WHERE slot = 'd7')        AS net_7,
      (SELECT order_count    FROM s WHERE slot = 'today')     AS ord_t,
      (SELECT order_count    FROM s WHERE slot = 'yesterday') AS ord_y,
      (SELECT order_count    FROM s WHERE slot = 'd7')        AS ord_7,
      (SELECT customer_count FROM s WHERE slot = 'today')     AS cst_t,
      (SELECT customer_count FROM s WHERE slot = 'yesterday') AS cst_y,
      (SELECT customer_count FROM s WHERE slot = 'd7')        AS cst_7,
      (SELECT items          FROM s WHERE slot = 'today')     AS itm_t,
      (SELECT items          FROM s WHERE slot = 'yesterday') AS itm_y,
      (SELECT items          FROM s WHERE slot = 'd7')        AS itm_7,
      (SELECT basket         FROM s WHERE slot = 'today')     AS bkt_t,
      (SELECT basket         FROM s WHERE slot = 'yesterday') AS bkt_y,
      (SELECT basket         FROM s WHERE slot = 'd7')        AS bkt_7,
      (SELECT margin         FROM s WHERE slot = 'today')     AS mrg_t,
      (SELECT margin         FROM s WHERE slot = 'yesterday') AS mrg_y,
      (SELECT margin         FROM s WHERE slot = 'd7')        AS mrg_7,
      (SELECT coverage       FROM s WHERE slot = 'today')     AS cov_t
  )
  SELECT jsonb_build_object(
    'net_revenue', jsonb_build_object(
      'value', p.net_t, 'vs_yesterday', _pct_change(p.net_t, p.net_y),
      'vs_d7', _pct_change(p.net_t, p.net_7)),
    'orders', jsonb_build_object(
      'value', p.ord_t, 'vs_yesterday', _pct_change(p.ord_t, p.ord_y),
      'vs_d7', _pct_change(p.ord_t, p.ord_7)),
    'customers', jsonb_build_object(
      'value', p.cst_t, 'vs_yesterday', _pct_change(p.cst_t, p.cst_y),
      'vs_d7', _pct_change(p.cst_t, p.cst_7)),
    'items_sold', jsonb_build_object(
      'value', p.itm_t, 'vs_yesterday', _pct_change(p.itm_t, p.itm_y),
      'vs_d7', _pct_change(p.itm_t, p.itm_7)),
    'avg_basket', jsonb_build_object(
      'value', p.bkt_t, 'vs_yesterday', _pct_change(p.bkt_t, p.bkt_y),
      'vs_d7', _pct_change(p.bkt_t, p.bkt_7)),
    'gross_margin', jsonb_build_object(
      'value', p.mrg_t,
      'vs_yesterday_pt', ROUND(p.mrg_t - p.mrg_y, 2),
      'vs_d7_pt',        ROUND(p.mrg_t - p.mrg_7, 2),
      'basis',             'current_cost_price',
      'cost_coverage_pct', p.cov_t)
  ) INTO v_out FROM p;

  RETURN v_out;
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_kpis_v3(p_tz text, p_today date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._dashboard_kpis_v3(p_tz text, p_today date) TO service_role;
DROP FUNCTION public._dashboard_kpis_v2(p_tz text, p_today date);

CREATE OR REPLACE FUNCTION public._dashboard_revenue_series_v2(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_series  JSONB;
  v_summary JSONB;
BEGIN
  WITH days AS (
    SELECT d::date AS day, ROW_NUMBER() OVER (ORDER BY d) AS idx
      FROM generate_series(p_today - 59, p_today, interval '1 day') d
  ),
  valid AS (
    SELECT ((o.recognized_at AT TIME ZONE p_tz))::date AS day, o.total
      FROM reporting_private.recognized_sales_v2 o
     WHERE TRUE AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date BETWEEN p_today - 59 AND p_today
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE p_tz))::date AS day, SUM(r.total) AS refunds
      FROM reporting_private.closed_refunds_v1 r
     WHERE ((r.created_at AT TIME ZONE p_tz))::date BETWEEN p_today - 59 AND p_today
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  series AS (
    SELECT d.day, d.idx,
           (COALESCE(SUM(v.total), 0) - COALESCE(MAX(dr.refunds), 0))::NUMERIC(14,2) AS net
      FROM days d
      LEFT JOIN valid       v  ON v.day  = d.day
      LEFT JOIN day_refunds dr ON dr.day = d.day
     GROUP BY d.day, d.idx
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', cur.day, 'net', cur.net, 'prev_net', prev.net
         ) ORDER BY cur.day), '[]'::jsonb),
         jsonb_build_object(
           'total',      COALESCE(SUM(cur.net), 0),
           'prev_total', COALESCE(SUM(prev.net), 0),
           'delta_pct',  _pct_change(COALESCE(SUM(cur.net), 0),
                                     COALESCE(SUM(prev.net), 0)))
    INTO v_series, v_summary
    FROM series cur
    LEFT JOIN series prev ON prev.idx = cur.idx - 30
   WHERE cur.idx > 30;

  RETURN jsonb_build_object('series', v_series, 'summary', v_summary);
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_revenue_series_v2(p_tz text, p_today date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._dashboard_revenue_series_v2(p_tz text, p_today date) TO service_role;
DROP FUNCTION public._dashboard_revenue_series_v1(p_tz text, p_today date);

CREATE OR REPLACE FUNCTION public._dashboard_share_payments_v3(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_share    JSONB;
  v_payments JSONB;
BEGIN
  WITH t AS (
    SELECT o.order_type::text AS order_type,
           SUM(o.total)::NUMERIC(14,2) AS gross,
           COUNT(*)::INT AS cnt
      FROM reporting_private.recognized_sales_v2 o
     WHERE TRUE AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date = p_today
     GROUP BY o.order_type
  ),
  tot AS (SELECT COALESCE(SUM(gross), 0) AS g FROM t)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_type', t.order_type, 'gross', t.gross, 'order_count', t.cnt,
           'share_pct', ROUND((t.gross / NULLIF(tot.g, 0)) * 100, 1)
         ) ORDER BY t.gross DESC), '[]'::jsonb)
    INTO v_share FROM t CROSS JOIN tot;

  WITH pm AS (
    SELECT op.method::text AS method,
           SUM(op.amount)::NUMERIC(14,2) AS amount,
           COUNT(*)::INT AS cnt
      FROM reporting_private.closed_order_payments_v1 op
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = op.order_id
     WHERE (o.status<>'voided' OR o.outstanding_at IS NOT NULL)
       AND ((op.paid_at AT TIME ZONE p_tz))::date = p_today
     GROUP BY op.method
  ),
  pm_tot AS (SELECT COALESCE(SUM(amount), 0) AS a FROM pm),
  drawer AS (
    SELECT COALESCE(SUM(
             s.opening_cash + s.cash_in_total - s.cash_out_total
             + COALESCE((SELECT SUM(op.amount)
                           FROM reporting_private.closed_order_payments_v1 op
                           JOIN reporting_private.closed_pos_orders_v1 o ON o.id = op.order_id
                          WHERE op.session_id = s.id
                            AND (o.status<>'voided' OR o.outstanding_at IS NOT NULL)
                            AND op.method = 'cash'), 0)
             - COALESCE((SELECT SUM(rp.amount) FROM refund_payments rp JOIN reporting_private.closed_refunds_v1 r ON r.id=rp.refund_id JOIN reporting_private.closed_pos_orders_v1 ro ON ro.id=r.order_id
                 WHERE reporting_private.refund_payment_session_v1(r::public.refunds)=s.id AND rp.method='cash' AND (NOT r.is_full_void OR ro.outstanding_at IS NOT NULL)),0)
           ), 0) AS expected
      FROM reporting_private.closed_pos_sessions_v1 s
     WHERE s.status = 'open'
  )
  SELECT jsonb_build_object(
           'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'method', pm.method, 'amount', pm.amount, 'count', pm.cnt,
                        'share_pct', ROUND((pm.amount / NULLIF(pm_tot.a, 0)) * 100, 1)
                      ) ORDER BY pm.amount DESC) FROM pm CROSS JOIN pm_tot), '[]'::jsonb),
           'total', COALESCE((SELECT SUM(amount) FROM pm), 0),
           'cash_expected_drawer', CASE WHEN public.is_business_owner_v1() THEN (SELECT expected FROM drawer) ELSE NULL END)
    INTO v_payments;

  RETURN jsonb_build_object('revenue_share', v_share, 'payments', v_payments);
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_share_payments_v3(p_tz text, p_today date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._dashboard_share_payments_v3(p_tz text, p_today date) TO service_role;
DROP FUNCTION public._dashboard_share_payments_v2(p_tz text, p_today date);
