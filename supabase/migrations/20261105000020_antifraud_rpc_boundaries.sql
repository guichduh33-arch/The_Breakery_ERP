-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.set_product_base_unit_v4(p_product_id uuid, p_new_unit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN

 RETURN stock_private.mask_stock_payload(stock_private.set_product_base_unit_v2(p_product_id,p_new_unit));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.set_product_base_unit_v4(p_product_id uuid, p_new_unit text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_base_unit_v4(p_product_id uuid, p_new_unit text) TO authenticated,service_role;
DROP FUNCTION public.set_product_base_unit_v3(p_product_id uuid, p_new_unit text);

CREATE OR REPLACE FUNCTION public.create_product_v5(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN

 RETURN stock_private.mask_stock_payload(stock_private.create_product_v3(p_payload));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.create_product_v5(p_payload jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_v5(p_payload jsonb) TO authenticated,service_role;
DROP FUNCTION public.create_product_v4(p_payload jsonb);

CREATE OR REPLACE FUNCTION public.get_b2b_invoice_v3(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF NOT public.can_view_order_v2(p_order_id) THEN RAISE EXCEPTION 'business_day_not_released' USING ERRCODE='P0003'; END IF;
 RETURN stock_private.mask_stock_payload(stock_private.get_b2b_invoice_v1(p_order_id));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.get_b2b_invoice_v3(p_order_id uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_b2b_invoice_v3(p_order_id uuid) TO authenticated,service_role;
DROP FUNCTION public.get_b2b_invoice_v2(p_order_id uuid);

CREATE OR REPLACE FUNCTION public.update_product_v6(p_product_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN

 RETURN stock_private.mask_stock_payload(stock_private.update_product_v4(p_product_id,p_patch));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.update_product_v6(p_product_id uuid, p_patch jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_v6(p_product_id uuid, p_patch jsonb) TO authenticated,service_role;
DROP FUNCTION public.update_product_v5(p_product_id uuid, p_patch jsonb);

CREATE OR REPLACE FUNCTION public.get_cash_wallet_ledger_v4(p_account_code text, p_date_start date, p_date_end date)
 RETURNS TABLE(row_date date, remark text, category text, description text, supplier text, in_amount numeric, out_amount numeric, saldo numeric, ref_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acc_id  UUID;
  v_opening NUMERIC;
BEGIN
  IF p_account_code IS NULL OR p_account_code NOT LIKE '111%' THEN
    PERFORM public.assert_stock_owner_v1();
  END IF;
  IF NOT has_permission(auth.uid(), 'accounting.cash.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.cash.read' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_acc_id FROM accounts WHERE code = p_account_code;
  IF v_acc_id IS NULL THEN
    RAISE EXCEPTION 'unknown account code %', p_account_code USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_opening
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE jel.account_id = v_acc_id AND je.entry_date < p_date_start;

  RETURN QUERY
  WITH raw AS (
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (
              PARTITION BY je.entry_date ORDER BY MIN(s.opened_at)
           )::text AS rmk,
           NULL::text AS cat, NULL::text AS descr, NULL::text AS sup,
           SUM(jel.debit) AS in_amt, SUM(jel.credit) AS out_amt,
           'sale'::text AS rt, 1 AS grp
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    JOIN orders o          ON je.reference_type = 'sale' AND je.reference_id = o.id
    LEFT JOIN pos_sessions s ON s.id = o.session_id
    WHERE p_account_code = '1110'
      AND jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id

    UNION ALL

    SELECT je.entry_date AS d,
           COALESCE(jel.description, je.description) AS rmk,
           ec.name AS cat,
           ex.description AS descr,
           COALESCE(ex.vendor_name, sup.name) AS sup,
           jel.debit AS in_amt, jel.credit AS out_amt,
           je.reference_type AS rt, 0 AS grp
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    LEFT JOIN expenses ex            ON je.reference_type = 'expense'          AND je.reference_id = ex.id
    LEFT JOIN expense_categories ec  ON ec.id = ex.category_id
    LEFT JOIN purchase_payments pp   ON je.reference_type = 'purchase_payment' AND je.reference_id = pp.id
    LEFT JOIN purchase_orders po     ON po.id = pp.purchase_order_id
    LEFT JOIN suppliers sup          ON sup.id = po.supplier_id
    WHERE jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (p_account_code = '1110' AND je.reference_type = 'sale')
  ),
  ordered AS (
    SELECT d, rmk, cat, descr, sup, in_amt, out_amt, rt,
           row_number() OVER (ORDER BY d, grp DESC, rmk) AS rn
    FROM raw
  )
  SELECT o.d, o.rmk, o.cat, o.descr, o.sup, o.in_amt, o.out_amt,
         v_opening + SUM(o.in_amt - o.out_amt) OVER (ORDER BY o.rn
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo,
         o.rt
  FROM ordered o
  ORDER BY o.rn;
END $function$
;
REVOKE ALL ON FUNCTION public.get_cash_wallet_ledger_v4(p_account_code text, p_date_start date, p_date_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_wallet_ledger_v4(p_account_code text, p_date_start date, p_date_end date) TO authenticated,service_role;
DROP FUNCTION public.get_cash_wallet_ledger_v3(p_account_code text, p_date_start date, p_date_end date);

CREATE OR REPLACE FUNCTION public.get_dashboard_action_queue_v3()
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
      FROM reporting_private.closed_pos_sessions_v1 s
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

  IF has_permission(v_uid, 'inventory.read') AND can_view_business_day_v2(current_date) THEN
    SELECT COUNT(*)::INT INTO v_n FROM get_low_stock_v4();
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'low_stock', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' item' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' below minimum stock',
        'action', 'Review', 'to', '/backoffice/inventory/alerts');
    END IF;

    SELECT COUNT(*)::INT INTO v_n FROM get_reorder_suggestions_v3(30, 14);
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
      FROM reporting_private.closed_pos_orders_v1 o
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
REVOKE ALL ON FUNCTION public.get_dashboard_action_queue_v3() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_action_queue_v3() TO authenticated,service_role;
DROP FUNCTION public.get_dashboard_action_queue_v2();

CREATE OR REPLACE FUNCTION public._dashboard_cost_mtd_v3(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  WITH bounds AS (
    SELECT date_trunc('month', p_today)::date                        AS m_start,
           (date_trunc('month', p_today) - interval '1 month')::date AS p_start,
           (date_trunc('month', p_today) - interval '1 day')::date   AS p_end
  ),
  lines AS (
    SELECT a.code, a.name, a.account_class,
           SUM(l.debit - l.credit) FILTER (WHERE j.entry_date BETWEEN b.m_start AND p_today) AS mtd,
           SUM(l.debit - l.credit) FILTER (
             WHERE j.entry_date BETWEEN b.p_start AND b.p_end)              AS prev
      FROM reporting_private.closed_shift_journal_lines_v1 l
      JOIN accounts a        ON a.id = l.account_id
      JOIN reporting_private.closed_shift_journal_entries_v1 j ON j.id = l.journal_entry_id AND j.status = 'posted'
      CROSS JOIN bounds b
     WHERE a.account_type = 'expense'
       AND j.entry_date BETWEEN b.p_start AND p_today
     GROUP BY a.code, a.name, a.account_class
  ),
  scoped AS (
    SELECT code, name,
           CASE WHEN account_class = 5 THEN 'cogs' ELSE 'opex' END AS family,
           COALESCE(mtd, 0) AS mtd, COALESCE(prev, 0) AS prev
      FROM lines
     WHERE COALESCE(mtd, 0) <> 0 OR COALESCE(prev, 0) <> 0
  ),
  sales_mtd AS (
    SELECT COALESCE(SUM(o.total), 0) AS net, COUNT(*) AS orders
      FROM reporting_private.recognized_sales_v2 o CROSS JOIN bounds b
     WHERE TRUE AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date BETWEEN b.m_start AND p_today
  ),
  totals AS (
    SELECT COALESCE((SELECT SUM(mtd) FROM scoped WHERE family = 'cogs'), 0) AS cogs,
           COALESCE((SELECT SUM(mtd) FROM scoped WHERE family = 'opex'), 0) AS opex,
           COALESCE((SELECT SUM(mtd) FROM scoped), 0)                       AS all_cost,
           (SELECT net FROM sales_mtd)                                      AS sales,
           (SELECT orders FROM sales_mtd)                                   AS orders
  )
  SELECT jsonb_build_object(
    'cogs_total',        t.cogs,
    'opex_total',        t.opex,
    'sales_mtd',         t.sales,
    'cogs_pct_of_sales', ROUND((t.cogs / NULLIF(t.sales, 0)) * 100, 1),
    'opex_pct_of_sales', ROUND((t.opex / NULLIF(t.sales, 0)) * 100, 1),
    'total',             t.all_cost,
    'cost_per_basket',   CASE WHEN t.orders = 0 THEN NULL
                              ELSE ROUND(t.all_cost / t.orders, 0) END,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'account_code', code, 'account_name', name, 'family', family,
                 'amount', ROUND(mtd), 'mom_delta_pct', _pct_change(mtd, prev)
               ) ORDER BY mtd DESC) FROM scoped), '[]'::jsonb)
  ) INTO v_out FROM totals t;

  RETURN v_out;
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_cost_mtd_v3(p_tz text, p_today date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._dashboard_cost_mtd_v3(p_tz text, p_today date) TO service_role;
DROP FUNCTION public._dashboard_cost_mtd_v2(p_tz text, p_today date);

CREATE OR REPLACE FUNCTION public.get_cash_wallet_analysis_v3(p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue_by_shift JSONB;
  v_top_petty        JSONB;
  v_deposits         NUMERIC;
  v_boss             NUMERIC;
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.cash.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.cash.read' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_revenue_by_shift FROM (
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (PARTITION BY je.entry_date ORDER BY MIN(s.opened_at))::text AS shift,
           SUM(jel.debit) AS total
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id AND je.status='posted'
    JOIN accounts a ON a.id = jel.account_id AND a.code='1110'
    JOIN orders o ON je.reference_type='sale' AND je.reference_id=o.id
    LEFT JOIN pos_sessions s ON s.id=o.session_id
    WHERE je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id
    ORDER BY je.entry_date
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_petty FROM (
    SELECT cat.name AS category, SUM(line.debit) AS total, count(*) AS occurrences
    FROM reporting_private.closed_shift_journal_entries_v1 je
    JOIN reporting_private.closed_shift_journal_lines_v1 credit ON credit.journal_entry_id=je.id
      JOIN accounts ca ON ca.id=credit.account_id AND ca.code='1111' AND credit.credit > 0
    JOIN reporting_private.closed_shift_journal_lines_v1 line ON line.journal_entry_id=je.id AND line.debit > 0
    JOIN accounts cat ON cat.id=line.account_id
    WHERE je.reference_type='expense' AND je.status='posted'
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY cat.name
    ORDER BY SUM(line.debit) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(SUM(jel.debit),0) INTO v_deposits
  FROM reporting_private.closed_shift_journal_entries_v1 je JOIN reporting_private.closed_shift_journal_lines_v1 jel ON jel.journal_entry_id=je.id
  JOIN accounts a ON a.id=jel.account_id AND a.code='1112'
  WHERE je.reference_type='cash_movement' AND je.status='posted'
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  SELECT COALESCE(SUM(jel.debit),0) INTO v_boss
  FROM reporting_private.closed_shift_journal_entries_v1 je JOIN reporting_private.closed_shift_journal_lines_v1 jel ON jel.journal_entry_id=je.id
  JOIN accounts a ON a.id=jel.account_id AND a.code='3110'
  WHERE je.reference_type='cash_movement' AND je.status='posted'
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  RETURN jsonb_build_object(
    'revenue_by_shift', v_revenue_by_shift,
    'top_petty_categories', v_top_petty,
    'deposits_total', v_deposits,
    'boss_withdrawals_total', v_boss
  );
END $function$
;
REVOKE ALL ON FUNCTION public.get_cash_wallet_analysis_v3(p_date_start date, p_date_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_wallet_analysis_v3(p_date_start date, p_date_end date) TO authenticated,service_role;
DROP FUNCTION public.get_cash_wallet_analysis_v2(p_date_start date, p_date_end date);
