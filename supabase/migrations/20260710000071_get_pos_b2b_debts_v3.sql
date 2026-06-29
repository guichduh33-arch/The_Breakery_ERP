-- 20260710000071_get_pos_b2b_debts_v3.sql
-- S52 P1.2 (C4) — get_pos_b2b_debts v2 -> v3 : single source of truth.
-- v2 computed paid = Σ order_payments for ALL orders. B2B payments never land in
-- order_payments (they go to b2b_payments + b2b_payment_allocations), so a paid B2B invoice
-- showed 100% outstanding at the POS while BO showed it settled. v3 derives B2B `paid` from
-- b2b_payment_allocations; retail ardoise (non-b2b) keeps order_payments. POS == BO. DROP v2.

DROP FUNCTION IF EXISTS public.get_pos_b2b_debts_v2(uuid, int);

CREATE OR REPLACE FUNCTION public.get_pos_b2b_debts_v3(
  p_customer_id uuid DEFAULT NULL, p_lookback_days int DEFAULT 180
) RETURNS TABLE (
  order_id uuid, order_number text, order_type text, total numeric, paid numeric,
  outstanding numeric, created_at timestamptz, customer_id uuid, customer_name text,
  customer_phone text, b2b_credit_limit numeric, b2b_current_balance numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lookback int := LEAST(GREATEST(COALESCE(p_lookback_days,180),1),730);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='P0001'; END IF;
  RETURN QUERY
    SELECT o.id, o.order_number, o.order_type::text, o.total::numeric,
           CASE WHEN o.order_type = 'b2b'
                THEN COALESCE(alloc.paid, 0)
                ELSE COALESCE(op.paid, 0) END::numeric AS paid,
           (o.total - CASE WHEN o.order_type='b2b' THEN COALESCE(alloc.paid,0) ELSE COALESCE(op.paid,0) END)::numeric AS outstanding,
           o.created_at, c.id, c.name, c.phone,
           COALESCE(c.b2b_credit_limit,0)::numeric, COALESCE(c.b2b_current_balance,0)::numeric
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN LATERAL (SELECT SUM(op2.amount) AS paid FROM order_payments op2 WHERE op2.order_id=o.id) op ON TRUE
    LEFT JOIN LATERAL (SELECT SUM(a.amount_applied) AS paid FROM b2b_payment_allocations a WHERE a.invoice_id=o.id) alloc ON TRUE
    WHERE o.customer_id IS NOT NULL
      AND o.status <> 'voided'
      AND o.created_at >= now() - make_interval(days => v_lookback)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (o.total - CASE WHEN o.order_type='b2b' THEN COALESCE(alloc.paid,0) ELSE COALESCE(op.paid,0) END) > 0.001
    ORDER BY o.created_at ASC;
END $$;

REVOKE ALL ON FUNCTION public.get_pos_b2b_debts_v3(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pos_b2b_debts_v3(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_b2b_debts_v3(uuid, int) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_pos_b2b_debts_v3(uuid, int) IS
  'S52 P1.2 (C4) — POS outstanding-debts: B2B paid derived from b2b_payment_allocations, '
  'retail ardoise from order_payments. POS == BO. Definer so it survives customers.read gate.';
