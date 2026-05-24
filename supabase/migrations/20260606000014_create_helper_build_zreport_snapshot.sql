-- 20260606000014_create_helper_build_zreport_snapshot.sql
-- S29 Wave 1.B.1 — Helper qui agrège les données d'un shift pour figer le snapshot Z-Report.
-- Fonction interne (préfixe _) appelée par close_shift_v2 ; pas exposée aux clients.
--
-- Deviations from spec template (DEV-S29-1.B-01):
--   - pos_sessions has no session_number, cashier_terminal_id, cash_expected, cash_counted
--     → using id, closing_cash (=counted), expected_cash columns instead
--   - order_items has name_snapshot not product_name
--   - refund_orders does not exist; using refunds table (columns: order_id, total)
--   - orders status enum: 'voided' (no 'cancelled' value)

CREATE OR REPLACE FUNCTION _build_zreport_snapshot(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session         pos_sessions%ROWTYPE;
  v_snapshot        JSONB;
  v_payment_totals  JSONB;
  v_top_products    JSONB;
  v_sales_total     NUMERIC(15,2);
  v_refunds_total   NUMERIC(15,2);
  v_voids_total     NUMERIC(15,2);
  v_expenses_cash   NUMERIC(15,2);
BEGIN
  SELECT * INTO v_session FROM pos_sessions WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift % not found', p_shift_id USING ERRCODE = 'P0002';
  END IF;

  -- Payment totals by method (excluding voided orders)
  SELECT COALESCE(jsonb_object_agg(method, total), '{}'::jsonb) INTO v_payment_totals
  FROM (
    SELECT op.method::text, SUM(op.amount) AS total
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE o.session_id = p_shift_id
      AND o.status::text NOT IN ('voided')
    GROUP BY op.method
  ) t;

  -- Gross sales total (excluding voided)
  SELECT COALESCE(SUM(total), 0) INTO v_sales_total
  FROM orders
  WHERE session_id = p_shift_id
    AND status::text NOT IN ('voided');

  -- Refunds: refunds.order_id → orders.session_id join
  SELECT COALESCE(SUM(r.total), 0) INTO v_refunds_total
  FROM refunds r
  JOIN orders o ON o.id = r.order_id
  WHERE o.session_id = p_shift_id;

  -- Voids total
  SELECT COALESCE(SUM(total), 0) INTO v_voids_total
  FROM orders
  WHERE session_id = p_shift_id
    AND status::text = 'voided';

  -- Top 10 products by quantity (excluding voided orders)
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

  -- Cash expenses paid during this shift window
  SELECT COALESCE(SUM(amount + COALESCE(vat_amount, 0)), 0) INTO v_expenses_cash
  FROM expenses e
  WHERE e.payment_method = 'cash'
    AND e.status = 'paid'
    AND e.paid_at >= v_session.opened_at
    AND (v_session.closed_at IS NULL OR e.paid_at <= v_session.closed_at);

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
    'refunds_total',         v_refunds_total,
    'voids_total',           v_voids_total,
    'expenses_cash_total',   v_expenses_cash,
    'top_products',          v_top_products,
    'generated_at',          now()
  );

  RETURN v_snapshot;
END;
$$;

COMMENT ON FUNCTION _build_zreport_snapshot(UUID) IS
  'S29 : helper interne agrégeant orders/order_payments/refunds/expenses pour figer le snapshot Z-Report au close_shift. SECURITY DEFINER. Appelé par close_shift_v2 uniquement.';

REVOKE EXECUTE ON FUNCTION _build_zreport_snapshot(UUID) FROM PUBLIC, anon, authenticated;
