CREATE OR REPLACE FUNCTION public._build_zreport_snapshot(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session         pos_sessions%ROWTYPE;
  v_snapshot        JSONB;
  v_payment_totals  JSONB;
  v_top_products    JSONB;
  v_sales_total     NUMERIC(15,2);
  v_refunds_total   NUMERIC(15,2);
  v_voids_total     NUMERIC(15,2);
  v_expenses_cash   NUMERIC(15,2);
  v_qris_expected   NUMERIC;
  v_card_expected   NUMERIC;
BEGIN
  SELECT * INTO v_session FROM pos_sessions WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift % not found', p_shift_id USING ERRCODE = 'P0002';
  END IF;
  -- Volontairement PAS restreint a paid|completed : cette somme porte sur
  -- order_payments, donc sur de l'argent reellement encaisse. Une ardoise
  -- pending_payment avec acompte doit y figurer.
  SELECT COALESCE(jsonb_object_agg(method, total), '{}'::jsonb) INTO v_payment_totals
  FROM (
    SELECT method, SUM(amount) AS total
    FROM (
    SELECT op.method::text AS method, op.amount
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE op.session_id = p_shift_id
      AND o.status::text NOT IN ('voided')
    UNION ALL
    SELECT rp.method::text, -rp.amount
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
    WHERE r.session_id = p_shift_id AND NOT r.is_full_void
      AND o.status::text <> 'voided'
    ) net_tenders
    GROUP BY method
  ) t;
  -- ADR-009 dec. 4 : les lecteurs financiers lisent paid|completed. Un
  -- NOT IN ('voided') laissait entrer draft, pending_payment et b2b_pending.
  SELECT COALESCE(SUM(total), 0) INTO v_sales_total
  FROM orders
  WHERE session_id = p_shift_id
    AND ((status IN ('paid', 'completed') AND outstanding_at IS NULL) OR (outstanding_at IS NOT NULL AND status<>'voided'));
  SELECT COALESCE(SUM(r.total), 0) INTO v_refunds_total
  FROM refunds r
  JOIN orders o ON o.id = r.order_id
  WHERE r.session_id = p_shift_id AND NOT r.is_full_void;
  SELECT COALESCE(SUM(total), 0) INTO v_voids_total
  FROM orders
  WHERE session_id = p_shift_id
    AND status::text = 'voided';
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_products
  FROM (
    SELECT
      oi.product_id,
      oi.name_snapshot  AS product_name,
      SUM(oi.quantity)::numeric    AS qty,
      SUM(oi.line_total)::numeric  AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.session_id = p_shift_id
      AND o.status::text NOT IN ('voided')
    GROUP BY oi.product_id, oi.name_snapshot
    ORDER BY qty DESC
    LIMIT 10
  ) t;
  SELECT COALESCE(SUM(amount + COALESCE(vat_amount, 0)), 0) INTO v_expenses_cash
  FROM expenses e
  WHERE e.payment_method = 'cash'
    AND e.status = 'paid'
    AND e.paid_at >= v_session.opened_at
    AND (v_session.closed_at IS NULL OR e.paid_at <= v_session.closed_at);
  SELECT COALESCE(SUM(op.amount), 0) INTO v_qris_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE op.session_id = p_shift_id
     AND o.status <> 'voided'
     AND op.method IN ('qris', 'gopay', 'ovo', 'dana');
  -- Les voids sont déjà exclus des encaissements ; leur miroir ne se déduit pas.
  SELECT v_qris_expected - COALESCE(SUM(rp.amount), 0) INTO v_qris_expected
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
   WHERE r.session_id = p_shift_id
     AND NOT r.is_full_void
     AND o.status IN ('paid', 'completed')
     AND rp.method IN ('qris', 'gopay', 'ovo', 'dana');
  SELECT COALESCE(SUM(op.amount), 0) INTO v_card_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE op.session_id = p_shift_id
     AND o.status <> 'voided'
     AND op.method IN ('card', 'edc');
  -- Les voids sont déjà exclus des encaissements ; leur miroir ne se déduit pas.
  SELECT v_card_expected - COALESCE(SUM(rp.amount), 0) INTO v_card_expected
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
   WHERE r.session_id = p_shift_id
     AND NOT r.is_full_void
     AND o.status IN ('paid', 'completed')
     AND rp.method IN ('card', 'edc');
  v_snapshot := jsonb_build_object(
    'shift_id',              p_shift_id,
    'opened_at',             v_session.opened_at,
    'closed_at',             v_session.closed_at,
    'opened_by',             v_session.opened_by,
    'closed_by',             v_session.closed_by,
    'opening_cash',          v_session.opening_cash,
    'closing_cash_expected', v_session.expected_cash,
    'closing_cash_counted',  v_session.closing_cash,
    'cash_variance',         COALESCE(v_session.closing_cash - v_session.expected_cash, 0),
    'cash_in_total',         COALESCE(v_session.cash_in_total, 0),
    'cash_out_total',        COALESCE(v_session.cash_out_total, 0),
    'totals_by_payment_method', v_payment_totals,
    'sales_total',           v_sales_total,
    'receipts_total', (SELECT coalesce(sum(p.amount),0) FROM order_payments p JOIN orders o ON o.id=p.order_id WHERE p.session_id=p_shift_id AND o.status<>'voided'),
    'outstanding_collections_total', (SELECT coalesce(sum(p.amount),0) FROM order_payments p JOIN orders o ON o.id=p.order_id WHERE p.session_id=p_shift_id AND o.outstanding_at IS NOT NULL AND o.status<>'voided'),
    'outstanding_created_total', (SELECT coalesce(sum(o.total),0) FROM orders o WHERE o.session_id=p_shift_id AND o.outstanding_at IS NOT NULL AND o.status<>'voided'),
    'refunds_total',         v_refunds_total,
    'voids_total',           v_voids_total,
    'expenses_cash_total',   v_expenses_cash,
    'reconciliation',        jsonb_build_object(
      'cash', jsonb_build_object(
        'expected', v_session.expected_cash,
        'counted',  v_session.closing_cash,
        'variance', COALESCE(v_session.closing_cash - v_session.expected_cash, 0)
      ),
      'qris', jsonb_build_object(
        'expected', v_qris_expected,
        'counted',  v_session.counted_qris,
        'variance', CASE WHEN v_session.counted_qris IS NULL THEN NULL
                         ELSE v_session.counted_qris - v_qris_expected END
      ),
      'card', jsonb_build_object(
        'expected', v_card_expected,
        'counted',  v_session.counted_card,
        'variance', CASE WHEN v_session.counted_card IS NULL THEN NULL
                         ELSE v_session.counted_card - v_card_expected END
      )
    ),
    'denominations',         v_session.closing_denominations,
    'top_products',          v_top_products,
    'generated_at',          now()
  );
  RETURN v_snapshot;
END;
$function$
;

CREATE FUNCTION public.get_shift_close_print_v1(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM pos_sessions s JOIN user_profiles u ON u.id=s.opened_by
   WHERE s.id=p_session_id AND u.auth_user_id=auth.uid() AND u.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003'; END IF;
 SELECT z.snapshot INTO v_result FROM z_reports z WHERE z.shift_id=p_session_id LIMIT 1;
 IF v_result IS NULL THEN RAISE EXCEPTION 'shift_report_not_found' USING ERRCODE='P0002'; END IF;
 RETURN v_result;
END $fn$;
REVOKE ALL ON FUNCTION public.get_shift_close_print_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_shift_close_print_v1(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
