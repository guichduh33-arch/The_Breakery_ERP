CREATE POLICY confidentiality_refund_lines ON public.refund_lines AS RESTRICTIVE FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.refunds r WHERE r.id=refund_id AND public.can_view_order_v1(r.order_id)));
CREATE POLICY confidentiality_promotions ON public.promotion_applications AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_view_order_v1(order_id));
CREATE POLICY confidentiality_order_replays ON public.order_edit_idempotency_keys AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_view_order_v1(order_id));
CREATE POLICY confidentiality_cancel_replays ON public.unpaid_order_cancel_keys AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_view_order_v1(order_id));
CREATE POLICY confidentiality_notifications ON public.notification_outbox AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_view_business_day_v1(created_at::date));
CREATE POLICY confidentiality_pos_events ON public.pos_events AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_view_business_day_v1(occurred_at::date));
