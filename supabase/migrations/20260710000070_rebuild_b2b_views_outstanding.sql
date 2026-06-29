-- 20260710000070_rebuild_b2b_views_outstanding.sql
-- S52 P1.2 (C3/C4) — views derive unpaid from the allocation ledger, not paid_at alone.
-- view_b2b_invoices : redefine is_unpaid = outstanding>0, exclude voided, APPEND amount_paid
--   and outstanding (CREATE OR REPLACE requires new columns appended at the end).
-- view_ar_aging : same long-format shape, total_outstanding now sums OUTSTANDING (partial-aware).

CREATE OR REPLACE VIEW public.view_b2b_invoices AS
SELECT
  o.id                                     AS invoice_id,
  o.order_number,
  o.customer_id,
  c.b2b_company_name,
  c.name                                   AS customer_name,
  o.total                                  AS invoice_total,
  o.created_at                             AS invoice_date,
  o.paid_at,
  o.status                                 AS order_status,
  (CURRENT_DATE - o.created_at::date)::int AS age_days,
  ((o.total - COALESCE(a.amount_paid, 0)) > 0) AS is_unpaid,
  COALESCE(a.amount_paid, 0)               AS amount_paid,
  (o.total - COALESCE(a.amount_paid, 0))   AS outstanding
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN LATERAL (
  SELECT SUM(amount_applied) AS amount_paid
    FROM b2b_payment_allocations WHERE invoice_id = o.id
) a ON TRUE
WHERE c.customer_type = 'b2b'
  AND c.deleted_at IS NULL
  AND o.order_type = 'b2b'
  AND o.status <> 'voided';

COMMENT ON VIEW public.view_b2b_invoices IS
  'S52 — outstanding = total - Sum(b2b_payment_allocations); is_unpaid = outstanding>0; excludes voided. SECURITY INVOKER.';

CREATE OR REPLACE VIEW public.view_ar_aging AS
 WITH unpaid AS (
   SELECT v.customer_id,
          v.b2b_company_name,
          v.customer_name,
          v.outstanding,
          v.age_days,
          CASE
            WHEN v.age_days <= 30 THEN 'current'::text
            WHEN v.age_days <= 60 THEN '31-60'::text
            WHEN v.age_days <= 90 THEN '61-90'::text
            ELSE '90+'::text
          END AS bucket
     FROM view_b2b_invoices v
    WHERE v.is_unpaid = true
 )
 SELECT customer_id,
        b2b_company_name,
        customer_name,
        bucket,
        count(*)            AS invoice_count,
        sum(outstanding)    AS total_outstanding,
        min(age_days)       AS min_age_days,
        max(age_days)       AS max_age_days
   FROM unpaid
  GROUP BY customer_id, b2b_company_name, customer_name, bucket;

COMMENT ON VIEW public.view_ar_aging IS
  'S52 — AR aging by OUTSTANDING (partial-payment aware), long-format customer×bucket. SECURITY INVOKER.';
