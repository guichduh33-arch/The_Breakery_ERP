-- Pickup is independent from settlement: payments continue to own status/paid_at.
ALTER TABLE public.orders ADD COLUMN b2b_delivered_at timestamptz;
COMMENT ON COLUMN public.orders.b2b_delivered_at IS 'Actual B2B collection time. NULL means collection has not been confirmed; never inferred from payment.';

CREATE OR REPLACE VIEW public.view_b2b_invoices WITH (security_invoker = true) AS
SELECT o.id AS invoice_id, o.order_number, o.customer_id, c.b2b_company_name,
 c.name AS customer_name, o.total AS invoice_total, o.created_at AS invoice_date,
 o.paid_at, o.status AS order_status, CURRENT_DATE - o.created_at::date AS age_days,
 (o.total - COALESCE(a.amount_paid, 0::numeric)) > 0 AS is_unpaid,
 COALESCE(a.amount_paid, 0::numeric) AS amount_paid,
 o.total - COALESCE(a.amount_paid, 0::numeric) AS outstanding,
 o.invoice_number, o.pickup_date, o.b2b_delivered_at
FROM public.orders o JOIN public.customers c ON c.id = o.customer_id
LEFT JOIN LATERAL (
 SELECT sum(amount_applied) AS amount_paid FROM public.b2b_payment_allocations
 WHERE invoice_id = o.id
) a ON true
WHERE c.customer_type = 'b2b' AND c.deleted_at IS NULL
 AND o.order_type = 'b2b' AND o.status <> 'voided';

-- This RPC is the only application write path for collection tracking.
CREATE FUNCTION public.update_b2b_pickup_v1(
 p_order_id uuid, p_pickup_date date DEFAULT NULL, p_mark_delivered boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_uid uuid := auth.uid();
 v_profile uuid;
 v_order public.orders%ROWTYPE;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
 IF NOT public.has_permission(v_uid, 'b2b.read')
    OR NOT public.has_permission(v_uid, 'pos.sale.create') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0003';
 END IF;
 SELECT id INTO v_profile FROM public.user_profiles
 WHERE auth_user_id = v_uid AND deleted_at IS NULL;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'user_profile_not_found'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.order_type <> 'b2b' THEN
  RAISE EXCEPTION 'b2b_order_not_found' USING ERRCODE = 'P0002';
 END IF;
 IF v_order.status = 'voided' THEN RAISE EXCEPTION 'order_voided'; END IF;
 IF p_mark_delivered IS NULL THEN RAISE EXCEPTION 'delivery_action_required'; END IF;
 IF v_order.b2b_delivered_at IS NOT NULL THEN
  IF NOT p_mark_delivered THEN RAISE EXCEPTION 'order_already_delivered'; END IF;
  RETURN jsonb_build_object('order_id', v_order.id, 'pickup_date', v_order.pickup_date,
    'b2b_delivered_at', v_order.b2b_delivered_at);
 END IF;
 IF NOT p_mark_delivered AND p_pickup_date IS NULL THEN
  RAISE EXCEPTION 'pickup_date_required';
 END IF;
 UPDATE public.orders SET
  pickup_date = COALESCE(p_pickup_date, pickup_date),
  b2b_delivered_at = CASE WHEN p_mark_delivered THEN now() ELSE NULL END,
  updated_at = now()
 WHERE id = p_order_id RETURNING * INTO v_order;
 INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
 VALUES(v_profile, CASE WHEN p_mark_delivered THEN 'b2b.order.delivered' ELSE 'b2b.order.pickup_updated' END,
  'orders', p_order_id, jsonb_build_object('pickup_date', v_order.pickup_date,
    'b2b_delivered_at', v_order.b2b_delivered_at));
 RETURN jsonb_build_object('order_id', v_order.id, 'pickup_date', v_order.pickup_date,
  'b2b_delivered_at', v_order.b2b_delivered_at);
END $$;
REVOKE ALL ON FUNCTION public.update_b2b_pickup_v1(uuid,date,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_b2b_pickup_v1(uuid,date,boolean) TO authenticated;
