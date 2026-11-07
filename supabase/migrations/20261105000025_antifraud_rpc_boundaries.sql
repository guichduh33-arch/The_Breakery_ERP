-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_discounts_loyalty_v3(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz         text;
  v_start      date;
  v_end        date;
  v_prev_start date;
  v_prev_end   date;
  v_result     jsonb;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id, o.order_number, o.total,
      COALESCE(o.discount_amount, 0)            AS order_discount,
      o.discount_reason,
      o.discount_authorized_by,
      COALESCE(o.promotion_total, 0)            AS promotion,
      COALESCE(o.loyalty_redemption_amount, 0)  AS redemption_value,
      ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  line_disc AS (
    SELECT s.bd, COALESCE(SUM(oi.discount_amount), 0) AS amount
    FROM reporting_private.closed_order_items_v1 oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
      AND COALESCE(oi.discount_amount, 0) > 0
    GROUP BY s.bd
  ),
  ledger AS (
    SELECT
      ((lt.created_at AT TIME ZONE v_tz))::date AS bd,
      COALESCE(SUM(lt.points) FILTER (WHERE lt.points > 0), 0)  AS points_issued,
      COALESCE(SUM(-lt.points) FILTER (WHERE lt.points < 0), 0) AS points_burned
    FROM loyalty_transactions lt
    WHERE ((lt.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  cur  AS (SELECT * FROM scoped WHERE bd BETWEEN v_start AND v_end),
  line_cur AS (SELECT * FROM line_disc WHERE bd BETWEEN v_start AND v_end),
  by_day AS (
    SELECT
      COALESCE(o.bd, l.bd, ld.bd) AS bd,
      COALESCE(o.order_discount, 0)    AS order_discount,
      COALESCE(o.promotion, 0)         AS promotion,
      COALESCE(o.redemption_value, 0)  AS redemption_value,
      COALESCE(ld.amount, 0)           AS line_discount,
      COALESCE(l.points_issued, 0)     AS points_issued,
      COALESCE(l.points_burned, 0)     AS points_burned
    FROM (
      SELECT bd, SUM(order_discount) AS order_discount, SUM(promotion) AS promotion,
             SUM(redemption_value) AS redemption_value
      FROM cur GROUP BY bd
    ) o
    FULL OUTER JOIN ledger   l  ON l.bd  = o.bd
    FULL OUTER JOIN line_cur ld ON ld.bd = COALESCE(o.bd, l.bd)
  ),
  tot AS (
    SELECT
      COALESCE((SELECT SUM(amount) FROM line_disc WHERE bd BETWEEN v_start AND v_end), 0) AS line_discount,
      COALESCE((SELECT SUM(order_discount)   FROM cur), 0) AS order_discount,
      COALESCE((SELECT SUM(promotion)        FROM cur), 0) AS promotion,
      COALESCE((SELECT SUM(redemption_value) FROM cur), 0) AS redemption_value,
      COALESCE((SELECT COUNT(*) FROM cur WHERE order_discount > 0), 0)                    AS pin_count,
      COALESCE((SELECT SUM(total) FROM cur), 0)                                           AS gross_sales,
      COALESCE((SELECT SUM(points_issued) FROM ledger), 0)                                AS points_issued,
      COALESCE((SELECT SUM(points_burned) FROM ledger), 0)                                AS points_burned
  ),
  tot_prev AS (
    SELECT
      COALESCE((SELECT SUM(amount) FROM line_disc WHERE bd < v_start), 0)                 AS line_discount,
      COALESCE((SELECT SUM(order_discount)   FROM scoped WHERE bd < v_start), 0)          AS order_discount,
      COALESCE((SELECT SUM(promotion)        FROM scoped WHERE bd < v_start), 0)          AS promotion,
      COALESCE((SELECT SUM(redemption_value) FROM scoped WHERE bd < v_start), 0)          AS redemption_value,
      COALESCE((SELECT SUM(total) FROM scoped WHERE bd < v_start), 0)                     AS gross_sales
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'line_discount',         t.line_discount,
      'order_discount',        t.order_discount,
      'promotion',             t.promotion,
      'redemption_value',      t.redemption_value,
      'line_discount_prev',    tp.line_discount,
      'order_discount_prev',   tp.order_discount,
      'promotion_prev',        tp.promotion,
      'redemption_value_prev', tp.redemption_value,
      'gross_sales',           t.gross_sales,
      'gross_sales_prev',      tp.gross_sales,
      'pin_count',             t.pin_count,
      'points_issued',         t.points_issued,
      'points_burned',         t.points_burned
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'date',             d.bd,
          'line_discount',    d.line_discount,
          'order_discount',   d.order_discount,
          'promotion',        d.promotion,
          'redemption_value', d.redemption_value,
          'points_issued',    d.points_issued,
          'points_burned',    d.points_burned
        ) ORDER BY d.bd ASC
      ) FROM by_day d
    ), '[]'::jsonb),
    'pin_discounts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'order_id',      c.id,
          'order_number',  c.order_number,
          'business_date', c.bd,
          'reason',        c.discount_reason,
          'amount',        c.order_discount,
          'authorized_by', jsonb_build_object('id', c.discount_authorized_by, 'name', up.full_name)
        ) ORDER BY c.order_discount DESC, c.bd DESC
      )
      FROM cur c
      LEFT JOIN user_profiles up ON up.id = c.discount_authorized_by
      WHERE c.order_discount > 0
    ), '[]'::jsonb),
    'by_promotion', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'promotion_id', bp.promotion_id,
          'description',  bp.description,
          'applications', bp.applications,
          'amount',       bp.amount
        ) ORDER BY bp.amount DESC
      )
      FROM (
        SELECT
          pa.promotion_id,
          (ARRAY_AGG(pa.description ORDER BY pa.created_at DESC))[1] AS description,
          COUNT(*)                    AS applications,
          COALESCE(SUM(pa.amount), 0) AS amount
        FROM promotion_applications pa
        JOIN cur c ON c.id = pa.order_id
        GROUP BY pa.promotion_id
      ) bp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, tot_prev tp;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_discounts_loyalty_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_discounts_loyalty_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_discounts_loyalty_v1(p_start_date date, p_end_date date);
DROP FUNCTION public.get_discounts_loyalty_v2(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.get_cash_wallet_balances_v4()
 RETURNS TABLE(account_code text, account_name text, balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.cash.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.cash.read' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.code, a.name,
         COALESCE(SUM(jel.debit - jel.credit) FILTER (WHERE je.id IS NOT NULL), 0)::numeric AS balance
  FROM accounts a
  LEFT JOIN reporting_private.closed_shift_journal_lines_v1 jel ON jel.account_id = a.id
  LEFT JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE a.code IN ('1110','1111','1117','1118','1119')
  GROUP BY a.code, a.name
  ORDER BY a.code;
END $function$
;
REVOKE ALL ON FUNCTION public.get_cash_wallet_balances_v4() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_wallet_balances_v4() TO authenticated,service_role;
DROP FUNCTION public.get_cash_wallet_balances_v3();

CREATE OR REPLACE FUNCTION public.get_ar_aging_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     text;
  v_today  date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  WITH open_inv AS (
    SELECT
      o.id, o.order_number, o.invoice_number, o.customer_id,
      ((o.created_at AT TIME ZONE v_tz))::date AS issued_on,
      o.total,
      COALESCE((SELECT SUM(a.amount_applied)
                  FROM b2b_payment_allocations a
                 WHERE a.invoice_id = o.id), 0)  AS settled,
      COALESCE(c.b2b_payment_terms_days, 30)     AS terms_days,
      c.name                                     AS customer_name,
      NULLIF(c.b2b_company_name, '')             AS company,
      c.b2b_credit_limit,
      c.b2b_current_balance
    FROM reporting_private.closed_pos_orders_v1 o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.order_type = 'b2b'
      AND o.status     = 'b2b_pending'
  ),
  inv AS (
    SELECT oi.*,
      oi.total - oi.settled                                AS outstanding,
      oi.issued_on + oi.terms_days                         AS due_date,
      GREATEST(v_today - (oi.issued_on + oi.terms_days), 0) AS days_late,
      CASE
        WHEN v_today <= oi.issued_on + oi.terms_days       THEN 'current'
        WHEN v_today - (oi.issued_on + oi.terms_days) <= 30 THEN 'late_1_30'
        WHEN v_today - (oi.issued_on + oi.terms_days) <= 60 THEN 'late_31_60'
        WHEN v_today - (oi.issued_on + oi.terms_days) <= 90 THEN 'late_61_90'
        ELSE 'late_90_plus'
      END AS bucket
    FROM open_inv oi
    WHERE oi.total - oi.settled > 0
  ),
  dso AS (
    SELECT CASE WHEN SUM(a.amount_applied) > 0 THEN
      ROUND(SUM(a.amount_applied *
                (((p.paid_at AT TIME ZONE v_tz))::date
                 - ((o.created_at AT TIME ZONE v_tz))::date))::numeric
            / SUM(a.amount_applied), 1)
    END AS days
    FROM b2b_payment_allocations a
    JOIN b2b_payments p ON p.id = a.payment_id
    JOIN reporting_private.closed_pos_orders_v1       o ON o.id = a.invoice_id
    WHERE ((p.paid_at AT TIME ZONE v_tz))::date >= v_today - 90
  )
  SELECT jsonb_build_object(
    'as_of',              v_today,
    'timezone',           v_tz,
    'generated_at',       now(),
    'terms_default_days', 30,
    'summary', jsonb_build_object(
      'total_outstanding',     COALESCE((SELECT SUM(outstanding) FROM inv), 0),
      'overdue_total',         COALESCE((SELECT SUM(outstanding) FROM inv WHERE bucket <> 'current'), 0),
      'invoice_count',         (SELECT COUNT(*) FROM inv),
      'overdue_invoice_count', (SELECT COUNT(*) FROM inv WHERE bucket <> 'current'),
      'customer_count',        (SELECT COUNT(DISTINCT customer_id) FROM inv),
      'oldest_days_late',      COALESCE((SELECT MAX(days_late) FROM inv), 0),
      'oldest_customer',       (SELECT customer_name FROM inv
                                 ORDER BY days_late DESC, outstanding DESC LIMIT 1),
      'dso_90d',               (SELECT days FROM dso)
    ),
    'by_bucket', (
      SELECT jsonb_agg(jsonb_build_object(
        'bucket',        b.code,
        'amount',        COALESCE(x.amount, 0),
        'invoice_count', COALESCE(x.n, 0)
      ) ORDER BY b.ord)
      FROM (VALUES
        ('current', 1), ('late_1_30', 2), ('late_31_60', 3),
        ('late_61_90', 4), ('late_90_plus', 5)
      ) AS b(code, ord)
      LEFT JOIN (
        SELECT bucket, SUM(outstanding) AS amount, COUNT(*) AS n
        FROM inv GROUP BY bucket
      ) x ON x.bucket = b.code
    ),
    'by_customer', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'customer_id',       bc.customer_id,
        'customer_name',     bc.customer_name,
        'company',           bc.company,
        'terms_days',        bc.terms_days,
        'credit_limit',      bc.b2b_credit_limit,
        'balance_cached',    bc.b2b_current_balance,
        'current',           bc.amt_current,
        'late_1_30',         bc.amt_1_30,
        'late_31_60',        bc.amt_31_60,
        'late_61_90',        bc.amt_61_90,
        'late_90_plus',      bc.amt_90p,
        'total_outstanding', bc.total_outstanding,
        'max_days_late',     bc.max_days_late
      ) ORDER BY bc.total_outstanding DESC)
      FROM (
        SELECT customer_id, customer_name, company, terms_days,
               b2b_credit_limit, b2b_current_balance,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'current'),      0) AS amt_current,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'late_1_30'),    0) AS amt_1_30,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'late_31_60'),   0) AS amt_31_60,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'late_61_90'),   0) AS amt_61_90,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'late_90_plus'), 0) AS amt_90p,
               SUM(outstanding) AS total_outstanding,
               MAX(days_late)   AS max_days_late
        FROM inv
        GROUP BY customer_id, customer_name, company, terms_days,
                 b2b_credit_limit, b2b_current_balance
      ) bc
    ), '[]'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'invoice_id',     i.id,
        'order_number',   i.order_number,
        'invoice_number', i.invoice_number,
        'customer_id',    i.customer_id,
        'customer_name',  i.customer_name,
        'issued_on',      i.issued_on,
        'due_date',       i.due_date,
        'days_late',      i.days_late,
        'bucket',         i.bucket,
        'total',          i.total,
        'settled',        i.settled,
        'outstanding',    i.outstanding
      ) ORDER BY i.days_late DESC, i.outstanding DESC)
      FROM inv i
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_ar_aging_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_ar_aging_v2() TO authenticated,service_role;
DROP FUNCTION public.get_ar_aging_v1();

CREATE OR REPLACE FUNCTION public.adjust_display_stock_v6(p_product_id uuid, p_new_qty numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_profile uuid; v_request jsonb;
 v_saved stock_private.mutation_requests%ROWTYPE; v_result jsonb; v_replay boolean:=false;
 v_is_display boolean; v_current numeric(10,3); v_delta numeric(10,3);
 v_effect uuid:=gen_random_uuid(); v_constraint text;
BEGIN
 IF v_uid IS NULL OR NOT has_permission(v_uid,'display.manage') THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
 END IF;
 SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id=v_uid
   AND is_active AND deleted_at IS NULL;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;
 IF p_new_qty IS NULL OR p_new_qty::text IN ('NaN','Infinity','-Infinity') OR p_new_qty<0
    OR p_new_qty>9999999.999 OR p_new_qty<>round(p_new_qty,3) THEN
   RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='22023';
 END IF;
 IF p_reason IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'reason_required'; END IF;
 v_request:=jsonb_build_object('product_id',p_product_id,'quantity',p_new_qty,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-mutation:'||p_idempotency_key::text,0));
 SELECT * INTO v_saved FROM stock_private.mutation_requests WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
   IF v_saved.actor_uid<>v_uid OR v_saved.operation<>'display_adjust' OR v_saved.request<>v_request THEN
     RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
   END IF;
   v_result:=v_saved.result; v_replay:=true;
 ELSE
   -- Une ancienne clé sans intention durable ne prouve pas ses paramètres initiaux.
   IF EXISTS(SELECT 1 FROM display_movements WHERE idempotency_key=p_idempotency_key)
      OR EXISTS(SELECT 1 FROM stock_movements WHERE idempotency_key=p_idempotency_key)
      OR EXISTS(SELECT 1 FROM stock_declarations WHERE idempotency_key=p_idempotency_key) THEN
     RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
   END IF;
   SELECT is_display_item INTO v_is_display FROM products
    WHERE id=p_product_id AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;
   IF NOT v_is_display THEN RAISE EXCEPTION 'not_a_display_item' USING ERRCODE='P0002'; END IF;
   SELECT quantity INTO v_current FROM display_stock WHERE product_id=p_product_id FOR UPDATE;
   v_current:=COALESCE(v_current,0); v_delta:=p_new_qty-v_current;
   IF v_delta<>0 THEN
     INSERT INTO display_movements(id,product_id,movement_type,quantity,reason,created_by,idempotency_key)
     VALUES(v_effect,p_product_id,'adjustment',v_delta,btrim(p_reason),v_profile,p_idempotency_key);
   END IF;
   -- Toute nouvelle intention émet le même signal, même pour un recomptage identique.
   INSERT INTO display_stock(product_id,quantity,updated_at) VALUES(p_product_id,p_new_qty,now())
   ON CONFLICT(product_id) DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=EXCLUDED.updated_at;
   v_result:=jsonb_build_object('product_id',p_product_id,'effect_id',v_effect,
     'new_display_stock',p_new_qty,'noop',v_delta=0,
     'display_movement_id',CASE WHEN v_delta<>0 THEN v_effect ELSE NULL END);
   INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
   VALUES(v_profile,'display.adjust',CASE WHEN v_delta=0 THEN 'display_adjustment' ELSE 'display_movement' END,
     v_effect,jsonb_build_object('product_id',p_product_id,'previous_qty',v_current,'new_qty',p_new_qty,
       'delta',v_delta,'reason',btrim(p_reason),'idempotency_key',p_idempotency_key),v_result);
   INSERT INTO stock_private.mutation_requests(idempotency_key,actor_uid,operation,request,result)
   VALUES(p_idempotency_key,v_uid,'display_adjust',v_request,v_result);
 END IF;
 IF can_view_business_day_v2(current_date) THEN
   RETURN v_result||jsonb_build_object('idempotent_replay',v_replay);
 END IF;
 -- Même un no-op garde un identifiant opaque : aucune comparaison avec l'ancien stock ne fuit.
 RETURN jsonb_build_object('product_id',v_result->'product_id','effect_id',v_result->'effect_id',
   'new_display_stock',NULL,'idempotent_replay',v_replay);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
 IF v_constraint NOT IN ('display_movements_idempotency_key_key','mutation_requests_pkey') THEN RAISE; END IF;
 SELECT * INTO v_saved FROM stock_private.mutation_requests WHERE idempotency_key=p_idempotency_key;
 IF NOT FOUND OR v_saved.actor_uid<>v_uid OR v_saved.operation<>'display_adjust' OR v_saved.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
 END IF;
 IF can_view_business_day_v2(current_date) THEN
   RETURN v_saved.result||jsonb_build_object('idempotent_replay',true);
 END IF;
 RETURN jsonb_build_object('product_id',v_saved.result->'product_id','effect_id',v_saved.result->'effect_id',
   'new_display_stock',NULL,'idempotent_replay',true);
END $function$
;
REVOKE ALL ON FUNCTION public.adjust_display_stock_v6(p_product_id uuid, p_new_qty numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_display_stock_v6(p_product_id uuid, p_new_qty numeric, p_reason text, p_idempotency_key uuid) TO authenticated,service_role;
DROP FUNCTION public.adjust_display_stock_v5(p_product_id uuid, p_new_qty numeric, p_reason text, p_idempotency_key uuid);
