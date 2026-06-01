-- 20260601050000_fix_recalc_order_totals_pb1_inclusive.sql
-- Audit fix H2 (2026-06-01) — _recalc_order_totals computed PB1 tax-EXCLUSIVE
-- (tax = subtotal * rate, total = subtotal + tax) while the ENTIRE system prices
-- PB1-INCLUSIVE: order line prices already embed PB1, so
--     tax   = round_idr(subtotal * rate / (1 + rate))   -- extracted portion
--     total = subtotal                                   -- gross == total
-- (cf. complete_order_with_payment_v10:280, cancel_order_item_rpc_v2,
--  refund_order_rpc_v3, and round_idr() rounds to nearest 100 IDR like the rest).
--
-- Symptom before fix: after any edit-items add/update/remove on a draft/
-- pending_payment order, `total` was inflated by ~PB1% and `tax_amount` no longer
-- matched how the order was priced / its JE / its receipt.
--
-- Internal helper, signature unchanged → CREATE OR REPLACE (no version bump;
-- same convention as the S25 corrective _015 on refund_order_rpc_v2).

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
  -- PB1-INCLUSIVE: subtotal (sum of line_total) is the gross that already
  -- contains PB1; total == gross, tax is the embedded share.
  v_tax := round_idr(v_subtotal * v_tax_rate / (1 + v_tax_rate));

  UPDATE orders SET
    subtotal   = v_subtotal,
    tax_amount = v_tax,
    total      = v_subtotal,
    updated_at = now()
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM authenticated;

COMMENT ON FUNCTION public._recalc_order_totals IS
  'S33 helper, H2 audit fix 2026-06-01: PB1-INCLUSIVE recompute '
  '(tax = round_idr(subtotal * rate / (1 + rate)), total = subtotal). '
  'Internal — REVOKEd from all roles, invoked only via the add/update_qty/'
  'remove_order_item_v1 SECURITY DEFINER chain.';
