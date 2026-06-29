-- 20260710000065_create_b2b_payment_allocations.sql
-- S52 P1.2 — append-only ledger linking a B2B payment to specific invoices.
-- Outstanding-per-invoice = orders.total − Σ amount_applied. Single derivation point
-- replacing the metadata-only b2b_payments.allocation JSONB snapshot (closes C3/C4).
CREATE TABLE IF NOT EXISTS public.b2b_payment_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid NOT NULL REFERENCES public.b2b_payments(id) ON DELETE RESTRICT,
  invoice_id     uuid NOT NULL REFERENCES public.orders(id)       ON DELETE RESTRICT,
  amount_applied numeric(14,2) NOT NULL CHECK (amount_applied > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_b2b_alloc_invoice ON public.b2b_payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_b2b_alloc_payment ON public.b2b_payment_allocations(payment_id);

ALTER TABLE public.b2b_payment_allocations ENABLE ROW LEVEL SECURITY;

-- SELECT for authenticated; no INSERT/UPDATE/DELETE policy (written only by SECURITY DEFINER RPCs).
DROP POLICY IF EXISTS b2b_alloc_auth_read ON public.b2b_payment_allocations;
CREATE POLICY b2b_alloc_auth_read ON public.b2b_payment_allocations
  FOR SELECT TO authenticated USING (true);

-- Anon defense-in-depth + revoke writes (mirror b2b_payments _010).
REVOKE ALL ON public.b2b_payment_allocations FROM PUBLIC;
REVOKE ALL ON public.b2b_payment_allocations FROM anon;
-- authenticated inherits INSERT/UPDATE/DELETE via postgres default privileges — revoke
-- them explicitly (RLS already denies, this is defense-in-depth; mirror b2b_payments _010).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.b2b_payment_allocations FROM authenticated;
GRANT SELECT ON public.b2b_payment_allocations TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

COMMENT ON TABLE public.b2b_payment_allocations IS
  'S52 P1.2 — append-only allocation ledger (payment -> invoice). Written only by '
  'record_b2b_payment_v2 (SECURITY DEFINER). invoice_outstanding = orders.total - Sum(amount_applied).';
