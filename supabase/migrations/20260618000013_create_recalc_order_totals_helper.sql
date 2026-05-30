-- 20260618000013_create_recalc_order_totals_helper.sql
-- Session 33 / Wave 1.3 — internal helper called by add/update_qty/remove RPCs.
-- Recomputes subtotal + tax_amount + total from order_items + current_pb1_rate().

CREATE OR REPLACE FUNCTION public._recalc_order_totals(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_subtotal NUMERIC := 0;
  v_tax_rate NUMERIC := 0;
  v_tax      NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal
  FROM order_items WHERE order_id = p_order_id;

  v_tax_rate := current_pb1_rate();
  v_tax      := ROUND(v_subtotal * v_tax_rate, 2);

  UPDATE orders SET
    subtotal   = v_subtotal,
    tax_amount = v_tax,
    total      = v_subtotal + v_tax,
    updated_at = now()
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._recalc_order_totals IS
  'S33 — Internal helper. Recomputes order subtotal/tax/total from order_items. '
  'Caller must be SECURITY DEFINER (callers: add_order_item_v1, update_order_item_qty_v1, '
  'remove_order_item_v1). REVOKEd from all roles — only invoked via DEFINER chain.';
