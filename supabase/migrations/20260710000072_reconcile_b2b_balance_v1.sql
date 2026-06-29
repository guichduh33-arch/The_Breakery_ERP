-- 20260710000072_reconcile_b2b_balance_v1.sql
-- S52 P1.2 (D3) — read-only: cached b2b_current_balance vs ledger-derived outstanding.
-- Alert only (no auto-fix). Manual correction goes through adjust_b2b_balance_v2. Gate b2b.read.
CREATE OR REPLACE FUNCTION public.reconcile_b2b_balance_v1(p_customer_id uuid DEFAULT NULL)
RETURNS TABLE (customer_id uuid, customer_name text, cached_balance numeric,
               derived_balance numeric, drift numeric, has_drift boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF NOT has_permission(auth.uid(), 'b2b.read') THEN
    RAISE EXCEPTION 'permission_denied: b2b.read' USING ERRCODE='P0003';
  END IF;
  RETURN QUERY
    SELECT c.id, c.name,
           COALESCE(c.b2b_current_balance,0)::numeric AS cached_balance,
           COALESCE(d.derived,0)::numeric             AS derived_balance,
           (COALESCE(c.b2b_current_balance,0) - COALESCE(d.derived,0))::numeric AS drift,
           (COALESCE(c.b2b_current_balance,0) <> COALESCE(d.derived,0))         AS has_drift
    FROM customers c
    LEFT JOIN LATERAL (
      SELECT SUM(v.outstanding) AS derived FROM view_b2b_invoices v
       WHERE v.customer_id = c.id AND v.is_unpaid = TRUE
    ) d ON TRUE
    WHERE c.customer_type = 'b2b' AND c.deleted_at IS NULL
      AND (p_customer_id IS NULL OR c.id = p_customer_id)
    ORDER BY abs(COALESCE(c.b2b_current_balance,0) - COALESCE(d.derived,0)) DESC;
END $$;

REVOKE ALL ON FUNCTION public.reconcile_b2b_balance_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_b2b_balance_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_b2b_balance_v1(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.reconcile_b2b_balance_v1(uuid) IS
  'S52 P1.2 (D3) — read-only drift alert: cached b2b_current_balance vs Σ outstanding from '
  'view_b2b_invoices. has_drift=true when they differ. Gate b2b.read. No auto-fix.';
