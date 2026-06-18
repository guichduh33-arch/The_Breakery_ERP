-- 20260701000019_revoke_extra_privileges_purchase_payments.sql
-- Session 46 / Wave C — append-only hardening for purchase_payments (DEV-S46-B-PG1).
--
-- pattern-guardian (Wave B review) flagged that purchase_payments grants
-- `authenticated` the auto-granted TRUNCATE / TRIGGER / REFERENCES privileges.
-- REVOKE DELETE alone does NOT cover TRUNCATE — an authenticated role could
-- TRUNCATE the ledger and erase all payment history, defeating the append-only
-- guarantee (TRUNCATE is not row-level and is not gated by RLS).
--
-- Mirrors the Stock-Audit m1 corrective (migration 20260626000016) which stripped
-- TRUNCATE/TRIGGER/REFERENCES from the stock ledger tables. anon already holds no
-- privileges here (S20 ALTER DEFAULT PRIVILEGES) — these REVOKEs are defense-in-depth.

REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.purchase_payments FROM authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.purchase_payments FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.purchase_payments FROM PUBLIC;

COMMENT ON TABLE public.purchase_payments IS
  'Session 46 — S46-A4 (hardened S46-C). Append-only ledger of supplier payments. '
  'Writes only via record_po_payment_v1 (SECURITY DEFINER). REVOKE INSERT/UPDATE/DELETE '
  '+ TRUNCATE/TRIGGER/REFERENCES from authenticated/anon/PUBLIC = true append-only.';
