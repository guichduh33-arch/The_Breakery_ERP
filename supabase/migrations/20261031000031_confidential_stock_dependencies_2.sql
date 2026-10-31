CREATE OR REPLACE FUNCTION public.get_dashboard_action_queue_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_tz    TEXT;
  v_today DATE;
  v_items JSONB := '[]'::jsonb;
  v_n     INT;
  v_date  DATE;
  v_days  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'permission denied: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  IF has_permission(v_uid, 'zreports.read') THEN
    SELECT COUNT(*)::INT, MIN(((s.opened_at AT TIME ZONE v_tz))::date)
      INTO v_n, v_date
      FROM pos_sessions s
     WHERE s.status = 'open'
       AND ((s.opened_at AT TIME ZONE v_tz))::date < v_today;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'register_not_closed', 'severity', 'blocking', 'count', v_n,
        'label', CASE WHEN v_n = 1
                      THEN 'Register not closed - ' || to_char(v_date, 'DD Mon')
                      ELSE v_n || ' registers not closed since ' || to_char(v_date, 'DD Mon') END,
        'action', 'Reconcile', 'to', '/backoffice/cash-register/zreports');
    END IF;
  END IF;

  IF has_permission(v_uid, 'inventory.read') AND can_view_business_day_v1(current_date) THEN
    SELECT COUNT(*)::INT INTO v_n FROM get_low_stock_v3();
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'low_stock', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' item' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' below minimum stock',
        'action', 'Review', 'to', '/backoffice/inventory/alerts');
    END IF;

    SELECT COUNT(*)::INT INTO v_n FROM get_reorder_suggestions_v2(30, 14);
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'reorder', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' item' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' below reorder point',
        'action', 'Create PO', 'to', '/backoffice/purchasing/purchase-orders/new');
    END IF;
  END IF;

  IF has_permission(v_uid, 'purchasing.po.read') THEN
    SELECT COUNT(*)::INT INTO v_n
      FROM purchase_orders po
     WHERE po.status IN ('pending', 'partial')
       AND po.deleted_at IS NULL;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'po_awaiting_receipt', 'severity', 'info', 'count', v_n,
        'label', v_n || ' PO' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' awaiting receipt',
        'action', 'Receive', 'to', '/backoffice/purchasing/purchase-orders');
    END IF;
  END IF;

  IF has_permission(v_uid, 'b2b.read') THEN
    SELECT COUNT(*)::INT,
           MAX(v_today - (((o.created_at AT TIME ZONE v_tz))::date
               + COALESCE(c.b2b_payment_terms_days, bs.default_payment_terms, 30)))
      INTO v_n, v_days
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN b2b_settings bs ON TRUE
     WHERE o.order_type = 'b2b'
       AND o.status = 'b2b_pending'
       AND o.voided_at IS NULL
       AND ((o.created_at AT TIME ZONE v_tz))::date
           + COALESCE(c.b2b_payment_terms_days, bs.default_payment_terms, 30) < v_today;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'b2b_overdue', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' B2B invoice' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' overdue - up to ' || v_days || ' d',
        'action', 'Open', 'to', '/backoffice/b2b/payments');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', COALESCE((SELECT SUM((i->>'count')::INT)
                         FROM jsonb_array_elements(v_items) i), 0)::INT,
    'generated_at', now()
  );
END;
$function$
;
DROP FUNCTION public.get_dashboard_action_queue_v1();
REVOKE ALL ON FUNCTION public.get_dashboard_action_queue_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_action_queue_v2() TO authenticated;

