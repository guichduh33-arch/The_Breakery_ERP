-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_daily_sales_v5(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start    DATE;
  v_end      DATE;
  v_tz       TEXT;
  v_summary  JSONB;
  v_by_day   JSONB;
  v_sessions JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH valid_orders AS (
    SELECT o.id,
           o.total, o.outstanding_at,
           COALESCE(o.discount_amount, 0) + COALESCE(o.promotion_total, 0) AS discount,
           ((o.recognized_at AT TIME ZONE v_tz))::date AS day,
           EXISTS (SELECT 1 FROM reporting_private.closed_order_payments_v1 op WHERE op.order_id = o.id) AS tendered
      FROM reporting_private.recognized_sales_v2 o
     WHERE TRUE
       AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  day_orders AS (
    SELECT vo.day, COUNT(*)::INT AS order_count, SUM(vo.total)::NUMERIC(14,2) AS gross
      FROM valid_orders vo GROUP BY vo.day
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE v_tz))::date AS day, SUM(r.total) AS refund_total
      FROM reporting_private.closed_refunds_v1 r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  days AS (
    SELECT COALESCE(o.day, r.day) AS day,
           COALESCE(o.order_count, 0) AS order_count,
           COALESCE(o.gross, 0)::NUMERIC(14,2) AS gross,
           COALESCE(r.refund_total, 0)::NUMERIC(14,2) AS refunds
      FROM day_orders o FULL OUTER JOIN day_refunds r ON r.day = o.day
  ),
  discounts AS (
    SELECT COALESCE(SUM(vo.discount), 0)::NUMERIC(14,2) AS discount_total,
           COUNT(*) FILTER (WHERE vo.discount > 0)::INT AS discount_orders_count
      FROM valid_orders vo
  ),
  settlement AS (
    SELECT
      COALESCE(SUM(vo.total) FILTER (WHERE vo.tendered), 0)::NUMERIC(14,2)     AS tendered_total,
      COUNT(*) FILTER (WHERE vo.tendered)::INT                                  AS tendered_order_count,
      COALESCE(SUM(vo.total) FILTER (WHERE NOT vo.tendered), 0)::NUMERIC(14,2) AS on_account_total,
      COUNT(*) FILTER (WHERE NOT vo.tendered)::INT                              AS on_account_order_count
      FROM valid_orders vo
  ),
  receipts AS (
    SELECT coalesce(sum(p.amount),0) total, count(DISTINCT p.order_id) order_count,
      coalesce(sum(p.amount) FILTER (WHERE o.outstanding_at IS NOT NULL),0) outstanding_collections
    FROM reporting_private.closed_order_payments_v1 p JOIN reporting_private.closed_pos_orders_v1 o ON o.id=p.order_id
    WHERE (p.paid_at AT TIME ZONE v_tz)::date BETWEEN v_start AND v_end
      AND (o.status<>'voided' OR o.outstanding_at IS NOT NULL)
  ),
  receivables AS (
    SELECT coalesce(sum(greatest(o.total-coalesce(p.paid,0),0)),0) due
    FROM reporting_private.closed_pos_orders_v1 o LEFT JOIN LATERAL
      (SELECT sum(amount) paid FROM reporting_private.closed_order_payments_v1 WHERE order_id=o.id) p ON true
    WHERE o.outstanding_at IS NOT NULL AND o.status IN ('draft','pending_payment')
  ),
  voids AS (
    SELECT COUNT(*)::INT AS voids_count,
           COALESCE(SUM(o.total), 0)::NUMERIC(14,2) AS voids_value
      FROM reporting_private.closed_pos_orders_v1 o
     WHERE o.voided_at IS NOT NULL
       AND ((o.voided_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  )
  SELECT
    jsonb_build_object(
      'total',                 COALESCE(SUM(d.gross), 0),
      'order_count',           COALESCE(SUM(d.order_count), 0),
      'aov',                   CASE WHEN COALESCE(SUM(d.order_count), 0) = 0 THEN 0
                                    ELSE ROUND(SUM(d.gross) / SUM(d.order_count), 2) END,
      'refund_total',          COALESCE(SUM(d.refunds), 0),
      'net',                   COALESCE(SUM(d.gross), 0) - COALESCE(SUM(d.refunds), 0),
      'discount_total',        (SELECT discount_total FROM discounts),
      'discount_orders_count', (SELECT discount_orders_count FROM discounts),
      'voids_count',           (SELECT voids_count FROM voids),
      'voids_value',           (SELECT voids_value FROM voids),
      'tendered_total',          (SELECT tendered_total FROM settlement),
      'tendered_order_count',    (SELECT tendered_order_count FROM settlement),
      'on_account_total',        (SELECT on_account_total FROM settlement),
      'on_account_order_count',  (SELECT on_account_order_count FROM settlement),
      'receipts_total', (SELECT total FROM receipts),
      'receipts_order_count', (SELECT order_count FROM receipts),
      'outstanding_collections_total', (SELECT outstanding_collections FROM receipts),
      'outstanding_created_total', (SELECT coalesce(sum(total),0) FROM valid_orders WHERE outstanding_at IS NOT NULL),
      'outstanding_due_total', (SELECT due FROM receivables)
    ),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'date',        d.day,
        'order_count', d.order_count,
        'gross',       d.gross,
        'refunds',     d.refunds,
        'net',         d.gross - d.refunds,
        'aov',         CASE WHEN d.order_count = 0 THEN 0 ELSE ROUND(d.gross / d.order_count, 2) END
      ) ORDER BY d.day
    ), '[]'::jsonb)
  INTO v_summary, v_by_day
  FROM days d;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',             ps.id,
      'cashier',        up.full_name,
      'opened_at',      ps.opened_at,
      'opening_cash',   ps.opening_cash,
      'status',         ps.status::text,
      'closed_at',      ps.closed_at,
      'variance_total', ps.variance_total
    ) ORDER BY ps.opened_at
  ), '[]'::jsonb)
  INTO v_sessions
  FROM reporting_private.closed_pos_sessions_v1 ps
  LEFT JOIN user_profiles up ON up.id = ps.opened_by
  WHERE ((ps.opened_at AT TIME ZONE v_tz))::date <= v_end
    AND (ps.closed_at IS NULL OR ((ps.closed_at AT TIME ZONE v_tz))::date >= v_start);

  RETURN jsonb_build_object(
    'period',   jsonb_build_object('start', v_start, 'end', v_end),
    'summary',  v_summary,
    'by_day',   v_by_day,
    'sessions', v_sessions
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_daily_sales_v5(p_date_start text, p_date_end text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_v5(p_date_start text, p_date_end text) TO authenticated,service_role;
DROP FUNCTION public.get_daily_sales_v3(p_date_start text, p_date_end text);
DROP FUNCTION public.get_daily_sales_v4(p_date_start text, p_date_end text);

CREATE OR REPLACE FUNCTION stock_private.mask_stock_payload_for_day_v2(p_value jsonb, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_key text; v_value jsonb;
BEGIN
 IF public.can_view_stock_v1() THEN RETURN p_value; END IF;
 IF jsonb_typeof(p_value)='object' THEN
   v_result:='{}';
   FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_value) LOOP
     IF v_key IN ('current_stock','new_current_stock','new_bo_stock','new_display_stock',
       'available_after','material_stock','stock_before','stock_after','shortages') THEN
       v_result:=v_result||jsonb_build_object(v_key,NULL);
     ELSE v_result:=v_result||jsonb_build_object(v_key,stock_private.mask_stock_payload_for_day_v2(v_value,p_day)); END IF;
   END LOOP;
   RETURN v_result;
 ELSIF jsonb_typeof(p_value)='array' THEN
   SELECT COALESCE(jsonb_agg(stock_private.mask_stock_payload_for_day_v2(value,p_day) ORDER BY ord),'[]'::jsonb)
   INTO v_result FROM jsonb_array_elements(p_value) WITH ORDINALITY e(value,ord);
   RETURN v_result;
 END IF;
 RETURN p_value;
END $function$
;
REVOKE ALL ON FUNCTION stock_private.mask_stock_payload_for_day_v2(p_value jsonb, p_day date) FROM PUBLIC,anon,authenticated;
DROP FUNCTION stock_private.mask_stock_payload_for_day_v1(p_value jsonb, p_day date);

CREATE OR REPLACE FUNCTION public.get_stock_movement_ledger_v4(p_start text, p_end text, p_product_id uuid DEFAULT NULL::uuid, p_movement_type text DEFAULT NULL::text, p_section_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID        := auth.uid();
  v_tz        TEXT        := current_setting('TimeZone');
  v_start     TIMESTAMPTZ := (p_start::date)::timestamp           AT TIME ZONE v_tz;
  v_end_excl  TIMESTAMPTZ := ((p_end::date + 1))::timestamp       AT TIME ZONE v_tz;
  v_limit     INT         := LEAST(GREATEST(p_limit, 1), 10000);
  v_lines     JSONB;
  v_count     INT;
  v_total     INT;
  v_activation date;
  v_opening_visible boolean;
BEGIN
  PERFORM public.assert_stock_owner_v1();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v2(COALESCE(NULLIF(p_start::text,''),current_date::text)::date,COALESCE(NULLIF(p_end::text,''),current_date::text)::date);

  IF NOT (has_permission(v_caller_id, 'inventory.read')
          OR has_permission(v_caller_id, 'reports.inventory.read')) THEN
    RAISE EXCEPTION 'Permission denied: inventory.read' USING ERRCODE = '42501';
  END IF;

  SELECT activated_on INTO v_activation FROM business_day_visibility_config WHERE id;
  v_opening_visible := is_business_owner_v1() OR p_start::date <= v_activation OR
    (SELECT count(*) FROM business_day_releases WHERE day >= v_activation AND day < p_start::date)
      = p_start::date - v_activation;

  WITH opening AS (
    SELECT sm.product_id, SUM(sm.quantity) AS opening_qty
    FROM stock_movements sm
    WHERE sm.created_at < v_start
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_section_id    IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    GROUP BY sm.product_id
  ),
  in_range AS (
    SELECT
      sm.id,
      sm.product_id,
      p.name                    AS product_name,
      c.name                    AS product_group,
      sm.movement_type::text    AS movement_type,
      sm.quantity,
      sm.unit,
      COALESCE(p.cost_price, 0) AS price,
      sm.reference_type,
      sm.reference_id,
      sm.reason,
      ord.order_number          AS reference_label,
      sm.created_at,
      sm.created_by,
      COALESCE(o.opening_qty, 0)
        + SUM(sm.quantity) OVER (
            PARTITION BY sm.product_id
            ORDER BY sm.created_at, sm.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS balance_qty
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN reporting_private.closed_pos_orders_v1 ord ON sm.reference_type = 'orders' AND ord.id = sm.reference_id
    LEFT JOIN opening o ON o.product_id = sm.product_id
    WHERE sm.created_at >= v_start
      AND sm.created_at <  v_end_excl
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_section_id    IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    ORDER BY p.name, sm.created_at, sm.id
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT ir.*, ROW_NUMBER() OVER (ORDER BY ir.product_name, ir.created_at, ir.id) AS rn
    FROM in_range ir
  )
  SELECT
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id',              n.id,
        'movement_date',   (n.created_at AT TIME ZONE v_tz)::date,
        'created_time',    n.created_at,
        'movement_type',   n.movement_type,
        'product_id',      n.product_id,
        'product_name',    n.product_name,
        'product_group',   n.product_group,
        'unit',            n.unit,
        'incoming_qty',    GREATEST(n.quantity, 0),
        'outgoing_qty',    GREATEST(-n.quantity, 0),
        'beginning_qty',   CASE WHEN v_opening_visible THEN n.balance_qty - n.quantity ELSE NULL END,
        'balance_qty',     CASE WHEN v_opening_visible THEN n.balance_qty ELSE NULL END,
        'price',           n.price,
        'movement_amount', n.quantity * n.price,
        'reference_type',  n.reference_type,
        'reference_id',    n.reference_id,
        'reason',          n.reason,
        'reference_label', n.reference_label,
        'created_by_name', up.full_name
      ) ORDER BY n.product_name, n.created_at, n.id)
      FILTER (WHERE n.rn <= v_limit),
      '[]'::jsonb
    ),
    COUNT(*) FILTER (WHERE n.rn <= v_limit)::int,
    COUNT(*)::int
  INTO v_lines, v_count, v_total
  FROM numbered n
  LEFT JOIN user_profiles up ON up.id = n.created_by;

  RETURN jsonb_build_object(
    'lines',     v_lines,
    'truncated', v_total > v_limit,
    'row_count', v_count
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_stock_movement_ledger_v4(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_section_id uuid, p_limit integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_movement_ledger_v4(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_section_id uuid, p_limit integer) TO authenticated,service_role;
DROP FUNCTION public.get_stock_movement_ledger_v3(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_section_id uuid, p_limit integer);

CREATE OR REPLACE FUNCTION public.record_incoming_stock_v5(p_product_id uuid, p_quantity numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_day date;
BEGIN
 v_result:=stock_private.record_incoming_stock_v2(p_product_id,p_quantity,p_supplier_id,p_unit_cost,p_reason,p_idempotency_key);
 IF p_idempotency_key IS NOT NULL THEN
  SELECT created_at::date INTO v_day FROM stock_private.mutation_requests
  WHERE idempotency_key=p_idempotency_key AND actor_uid=auth.uid() AND operation='incoming';
 ELSE v_day:=current_date; END IF;
 RETURN stock_private.mask_stock_payload_for_day_v2(v_result,v_day);
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
 AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.record_incoming_stock_v5(p_product_id uuid, p_quantity numeric, p_supplier_id uuid, p_unit_cost numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_incoming_stock_v5(p_product_id uuid, p_quantity numeric, p_supplier_id uuid, p_unit_cost numeric, p_reason text, p_idempotency_key uuid) TO authenticated,service_role;
DROP FUNCTION public.record_incoming_stock_v4(p_product_id uuid, p_quantity numeric, p_supplier_id uuid, p_unit_cost numeric, p_reason text, p_idempotency_key uuid);

CREATE OR REPLACE FUNCTION public.get_sales_by_staff_v5(p_date_start date, p_date_end date)
 RETURNS TABLE(staff_id uuid, staff_name text, total numeric, order_count integer, avg_basket numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  )
  SELECT
    o.served_by                            AS staff_id,
    up.full_name                           AS staff_name,
    SUM(o.total)::DECIMAL(14,2)            AS total,
    COUNT(*)::INT                          AS order_count,
    (SUM(o.total) / NULLIF(COUNT(*), 0))::DECIMAL(14,2) AS avg_basket
  FROM reporting_private.recognized_sales_v2 o
  JOIN user_profiles up ON up.id = o.served_by
  WHERE TRUE
    AND o.recognized_at IS NOT NULL
    AND o.voided_at IS NULL
    AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY o.served_by, up.full_name
  ORDER BY total DESC;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_staff_v5(p_date_start date, p_date_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_staff_v5(p_date_start date, p_date_end date) TO authenticated,service_role;
DROP FUNCTION public.get_sales_by_staff_v3(p_date_start date, p_date_end date);
DROP FUNCTION public.get_sales_by_staff_v4(p_date_start date, p_date_end date);

CREATE OR REPLACE FUNCTION public.get_sales_by_hour_v5(p_date date)
 RETURNS TABLE(hour integer, total numeric, order_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH cfg AS (SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz FROM business_config WHERE id = 1),
  bucketed AS (
    SELECT EXTRACT(HOUR FROM (o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::INT AS hour, o.total
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE AND o.recognized_at IS NOT NULL AND o.voided_at IS NULL
      AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::date = p_date
  ),
  rolled AS (SELECT b.hour, SUM(b.total)::DECIMAL(14,2) AS total, COUNT(*)::INT AS order_count FROM bucketed b GROUP BY b.hour),
  hours AS (SELECT generate_series(0, 23) AS hour)
  SELECT hours.hour, COALESCE(rolled.total, 0::DECIMAL(14,2)) AS total, COALESCE(rolled.order_count, 0) AS order_count
  FROM hours LEFT JOIN rolled USING (hour) ORDER BY hours.hour;
END; $function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_hour_v5(p_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_hour_v5(p_date date) TO authenticated,service_role;
DROP FUNCTION public.get_sales_by_hour_v3(p_date date);
DROP FUNCTION public.get_sales_by_hour_v4(p_date date);

CREATE OR REPLACE FUNCTION public.calculate_pb1_payable_v4(p_period_start date, p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_pb1_id      UUID;
  v_pb1_output  DECIMAL(14,2);
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0002';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  v_pb1_id := resolve_mapping_account('SALE_PB1_TAX');

  -- PB1 output = Σ credits on 2110 over period − Σ debits (reversals on voids/refunds).
  -- Dédup (S50 Vague 2a-i) : exclure la JE sale_void quand un refund existe pour le
  -- même order — sinon void + refund contre-passent 2110 deux fois → PB1 sous-déclaré.
  -- Mirror exact de get_profit_loss_v4 (S26 _017/_018).
  SELECT COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    INTO v_pb1_output
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1     je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND je.status IN ('posted', 'locked')
      AND NOT (je.reference_type = 'sale_void'
               AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN reporting_private.closed_refunds_v1 rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));

  RETURN jsonb_build_object(
    'period_start', p_period_start,
    'period_end',   p_period_end,
    'pb1_output',   v_pb1_output,
    'pb1_payable',  v_pb1_output,
    'tax_rate',     current_pb1_rate(),
    'tax_regime',   'NON_PKP_LOMBOK_PBJT',
    'note',         'NON-PKP — PBJT Makanan dan Minuman payable to Bapenda Lombok/NTB (UU HKPD 1/2022). No VAT input deduction (ADR-005).'
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.calculate_pb1_payable_v4(p_period_start date, p_period_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_pb1_payable_v4(p_period_start date, p_period_end date) TO authenticated,service_role;
DROP FUNCTION public.calculate_pb1_payable_v3(p_period_start date, p_period_end date);
