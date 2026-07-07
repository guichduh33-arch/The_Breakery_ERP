-- 20260710000133_view_b2b_invoices_invoice_number.sql
-- S68 — Expose orders.invoice_number sur view_b2b_invoices (additif, en fin de SELECT
-- pour respecter CREATE OR REPLACE VIEW). Définition reprise du LIVE, rien d'autre changé.

CREATE OR REPLACE VIEW public.view_b2b_invoices AS
 SELECT o.id AS invoice_id,
    o.order_number,
    o.customer_id,
    c.b2b_company_name,
    c.name AS customer_name,
    o.total AS invoice_total,
    o.created_at AS invoice_date,
    o.paid_at,
    o.status AS order_status,
    CURRENT_DATE - o.created_at::date AS age_days,
    (o.total - COALESCE(a.amount_paid, 0::numeric)) > 0::numeric AS is_unpaid,
    COALESCE(a.amount_paid, 0::numeric) AS amount_paid,
    o.total - COALESCE(a.amount_paid, 0::numeric) AS outstanding,
    o.invoice_number
   FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL ( SELECT sum(b2b_payment_allocations.amount_applied) AS amount_paid
           FROM b2b_payment_allocations
          WHERE b2b_payment_allocations.invoice_id = o.id) a ON true
  WHERE c.customer_type = 'b2b'::customer_type AND c.deleted_at IS NULL AND o.order_type = 'b2b'::order_type AND o.status <> 'voided'::order_status;
