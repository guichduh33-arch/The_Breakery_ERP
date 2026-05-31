-- 20260619000042_create_pos_b2b_debts_rpc.sql
-- Security hardening (security-fraud-guard gap 4, checklist D) — companion to _040.
--
-- The POS "outstanding B2B debts" panel (useOutstandingDebts) currently embeds
-- `customer:customers(...)` in an orders query. Once customers SELECT is gated
-- behind customers.read (finalizer _043, deferred), that PostgREST embed would be
-- filtered to NULL for POS roles, breaking the panel. Provide a definer RPC that
-- returns exactly the panel's shape (order + customer name/phone + paid/outstanding),
-- computed server-side. It deliberately does NOT expose b2b_credit_limit /
-- b2b_current_balance (the panel never displayed them; keep B2B financials BO-only).

CREATE OR REPLACE FUNCTION public.get_pos_b2b_debts_v1(
  p_customer_id UUID DEFAULT NULL
) RETURNS TABLE (
  order_id       UUID,
  order_number   TEXT,
  customer_id    UUID,
  customer_name  TEXT,
  customer_phone TEXT,
  total          NUMERIC,
  paid           NUMERIC,
  outstanding    NUMERIC,
  created_at     TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT o.id, o.order_number, o.customer_id, c.name, c.phone,
           o.total::numeric,
           COALESCE(p.paid, 0)::numeric,
           (o.total - COALESCE(p.paid, 0))::numeric,
           o.created_at
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN LATERAL (
      SELECT SUM(op.amount) AS paid FROM order_payments op WHERE op.order_id = o.id
    ) p ON TRUE
    WHERE o.order_type = 'b2b'
      AND o.status IN ('paid', 'b2b_pending', 'completed')
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (o.total - COALESCE(p.paid, 0)) > 0.001
    ORDER BY o.created_at DESC;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_pos_b2b_debts_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_b2b_debts_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_pos_b2b_debts_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_pos_b2b_debts_v1 IS
  'S34 gap 4: POS outstanding-B2B-debts panel. Definer so it survives the customers.read SELECT gate. Returns order + customer name/phone + paid/outstanding; no b2b credit-limit/balance exposure.';
