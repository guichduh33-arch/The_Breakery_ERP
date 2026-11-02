-- Contrat privé de reconnaissance ; aucun paiement ni statut n'est fabriqué.
CREATE SCHEMA IF NOT EXISTS reporting_private;
REVOKE ALL ON SCHEMA reporting_private FROM PUBLIC, anon, authenticated;
CREATE VIEW reporting_private.recognized_sales_v1 AS
SELECT o.*,
  CASE WHEN o.outstanding_at IS NOT NULL THEN o.outstanding_at
       ELSE coalesce(o.paid_at,o.created_at) END AS recognized_at
FROM public.orders o
WHERE o.status <> 'voided' AND o.voided_at IS NULL
  AND (o.outstanding_at IS NOT NULL OR o.status IN ('paid','completed'));
REVOKE ALL ON reporting_private.recognized_sales_v1 FROM PUBLIC, anon, authenticated;
CREATE FUNCTION reporting_private.refund_payment_session_v1(p_refund public.refunds)
RETURNS uuid LANGUAGE sql STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN to_jsonb(p_refund)->>'payment_source' IS NOT NULL
    THEN (to_jsonb(p_refund)->>'payment_session_id')::uuid ELSE p_refund.session_id END;
$fn$;
REVOKE ALL ON FUNCTION reporting_private.refund_payment_session_v1(public.refunds) FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA reporting_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
