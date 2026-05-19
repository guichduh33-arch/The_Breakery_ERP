-- 20260601000011_create_view_b2b_invoices.sql
-- Session 24 / Phase 1.A.1 / migration 5
--
-- Vue read-only des invoices B2B = orders avec customer_type='b2b'. SECURITY
-- INVOKER (default) — respecte les policies RLS de orders et customers.
--
-- "Invoice unpaid" en S24 = order avec paid_at IS NULL ET status='b2b_pending'.
-- Le status 'paid' est appliqué par record_b2b_payment_v1 lorsqu'un paiement
-- complet est encaissé (S26+ : allocation per-invoice exacte).
--
-- age_days = CURRENT_DATE - invoice_date (entier, jamais négatif tant que
-- invoice_date <= today).

CREATE OR REPLACE VIEW view_b2b_invoices AS
SELECT
  o.id                                    AS invoice_id,
  o.order_number,
  o.customer_id,
  c.b2b_company_name,
  c.name                                  AS customer_name,
  o.total                                 AS invoice_total,
  o.created_at                            AS invoice_date,
  o.paid_at,
  o.status                                AS order_status,
  (CURRENT_DATE - o.created_at::date)::int AS age_days,
  (o.paid_at IS NULL)                     AS is_unpaid
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.customer_type = 'b2b'
  AND c.deleted_at IS NULL
  AND o.order_type = 'b2b';

COMMENT ON VIEW view_b2b_invoices IS
  'Vue read-only des invoices B2B (orders avec order_type=b2b et customer_type=b2b). '
  'SECURITY INVOKER — respecte RLS de orders/customers. is_unpaid=TRUE ssi paid_at '
  'IS NULL. age_days = CURRENT_DATE - invoice_date. S24.';
