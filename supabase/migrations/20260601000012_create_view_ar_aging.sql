-- 20260601000012_create_view_ar_aging.sql
-- Session 24 / Phase 1.A.1 / migration 6
--
-- Vue AR Aging — buckets standards 0-30 / 31-60 / 61-90 / 90+ par customer
-- (agrégation sur view_b2b_invoices.is_unpaid=TRUE). Consommée par
-- useB2bDashboard (S24 fix : remplace le proxy last_visit_at).
--
-- Décision D6 (spec §2) : pas de due_date — on bucket sur invoice_date.
-- payment_terms_days existe sur customers (S13 carryover) mais n'est pas
-- utilisé en S24. Sera intégré S26 (Comptable Cockpit) qui ajoutera un
-- view_ar_aging_v2 avec due_date dérivé.
--
-- SECURITY INVOKER (default).

CREATE OR REPLACE VIEW view_ar_aging AS
WITH unpaid AS (
  SELECT
    customer_id,
    b2b_company_name,
    customer_name,
    invoice_total,
    age_days,
    CASE
      WHEN age_days <= 30 THEN 'current'
      WHEN age_days <= 60 THEN '31-60'
      WHEN age_days <= 90 THEN '61-90'
      ELSE '90+'
    END AS bucket
  FROM view_b2b_invoices
  WHERE is_unpaid = TRUE
)
SELECT
  customer_id,
  b2b_company_name,
  customer_name,
  bucket,
  COUNT(*)                        AS invoice_count,
  SUM(invoice_total)              AS total_outstanding,
  MIN(age_days)                   AS min_age_days,
  MAX(age_days)                   AS max_age_days
FROM unpaid
GROUP BY customer_id, b2b_company_name, customer_name, bucket;

COMMENT ON VIEW view_ar_aging IS
  'AR aging buckets (current/31-60/61-90/90+) par customer B2B avec invoices unpaid. '
  'SECURITY INVOKER — respecte RLS via view_b2b_invoices. Consommé par useB2bDashboard. S24.';
