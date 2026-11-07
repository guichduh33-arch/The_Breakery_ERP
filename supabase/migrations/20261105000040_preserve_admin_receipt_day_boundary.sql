-- Préserver aussi la frontière des journées ADMIN dans le lecteur de tickets.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.get_pos_transaction_history_v2(p_session_id uuid, p_order_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_session public.pos_sessions%ROWTYPE;
 v_number text:=nullif(btrim(p_order_number),'');
 v_visible boolean;
 v_orders jsonb;
 v_detail jsonb;
 v_order public.orders%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.request_has_active_pin_session_v1()
  OR NOT (public.is_business_owner_v1() OR public.has_permission(auth.uid(),'pos.sale.create')
   OR public.has_permission(auth.uid(),'orders.read')) THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003';
 END IF;
 SELECT * INTO v_session FROM public.pos_sessions WHERE id=p_session_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0002'; END IF;
 v_visible:=public.can_view_financial_shift_v1(v_session.id);
 IF NOT v_visible AND (public.get_current_role()='ADMIN'
  OR v_session.opened_by IS DISTINCT FROM public.get_current_profile_id()
  OR NOT public.has_permission(auth.uid(),'pos.sale.create')) THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003';
 END IF;
 IF v_number IS NOT NULL AND (length(v_number)>64 OR length(v_number)<3) THEN
  RAISE EXCEPTION 'invalid_receipt_number' USING ERRCODE='22023';
 END IF;
 IF public.get_current_role()='ADMIN' AND EXISTS(
  SELECT 1 FROM public.orders o WHERE o.session_id=v_session.id
   AND o.order_type<>'b2b' AND o.status::text IN('paid','completed','voided')
   AND (v_number IS NULL OR o.order_number=v_number)
   AND NOT public.can_view_sales_day_v1(coalesce(o.outstanding_at,o.paid_at,o.created_at)::date)
 ) THEN
  RAISE EXCEPTION 'business_day_not_closed' USING ERRCODE='P0003';
 END IF;
 IF NOT v_visible AND v_number IS NULL THEN
  RETURN jsonb_build_object('financial_visible',false,'orders','[]'::jsonb,'detail',NULL);
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.paid_at DESC NULLS LAST,q.id),'[]'::jsonb)
 INTO v_orders FROM (
  SELECT o.id,o.order_number,o.status,o.total,o.paid_at,o.voided_at,o.customer_id,
   o.table_number,o.order_type,
   coalesce((SELECT sum(r.total) FROM public.refunds r WHERE r.order_id=o.id
    AND (public.can_view_financial_shift_v1(coalesce(r.payment_session_id,r.session_id))
     OR (v_number IS NOT NULL AND coalesce(r.payment_session_id,r.session_id)=v_session.id))),0) AS total_refunded,
   (SELECT p.method FROM public.order_payments p WHERE p.order_id=o.id AND (public.can_view_financial_shift_v1(p.session_id)
     OR (v_number IS NOT NULL AND p.session_id=v_session.id)) ORDER BY p.id LIMIT 1) AS primary_payment_method,
   coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT p.method,sum(p.amount) AS amount FROM public.order_payments p
    WHERE p.order_id=o.id AND (public.can_view_financial_shift_v1(p.session_id)
     OR (v_number IS NOT NULL AND p.session_id=v_session.id)) GROUP BY p.method ORDER BY p.method) t),'[]'::jsonb) AS paid_by_method
  FROM public.orders o WHERE o.session_id=v_session.id
   AND o.order_type<>'b2b' AND o.status::text IN('paid','completed','voided')
   AND (v_number IS NULL OR o.order_number=v_number)
  ORDER BY o.paid_at DESC NULLS LAST,o.id LIMIT 500
 ) q;
 IF v_number IS NOT NULL THEN
  SELECT * INTO v_order FROM public.orders o WHERE o.session_id=v_session.id
   AND o.order_number=v_number AND o.order_type<>'b2b'
   AND o.status::text IN('paid','completed','voided');
  IF FOUND THEN
   SELECT jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,
    'total',o.total,'tax_amount',o.tax_amount,'customer_id',o.customer_id,
    'table_number',o.table_number,'paid_at',o.paid_at,'voided_at',o.voided_at,
    'void_reason',o.void_reason,'loyalty_points_redeemed',o.loyalty_points_redeemed,
    'order_items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,
     'name_snapshot',i.name_snapshot,'quantity',i.quantity,'line_total',i.line_total,
     'is_cancelled',i.is_cancelled) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=o.id),'[]'::jsonb),
    'order_payments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'method',p.method,
     'amount',p.amount,'reference',p.reference) ORDER BY p.id) FROM public.order_payments p
     WHERE p.order_id=o.id AND (public.can_view_financial_shift_v1(p.session_id)
     OR (v_number IS NOT NULL AND p.session_id=v_session.id))),'[]'::jsonb),
    'refunds',coalesce((SELECT jsonb_agg(jsonb_build_object('total',r.total,
     'refund_lines',coalesce((SELECT jsonb_agg(jsonb_build_object('order_item_id',l.order_item_id,
      'qty',l.qty)) FROM public.refund_lines l WHERE l.refund_id=r.id),'[]'::jsonb),
     'refund_payments',coalesce((SELECT jsonb_agg(jsonb_build_object('method',p.method,
      'amount',p.amount)) FROM public.refund_payments p WHERE p.refund_id=r.id),'[]'::jsonb)))
     FROM public.refunds r WHERE r.order_id=o.id
      AND (public.can_view_financial_shift_v1(coalesce(r.payment_session_id,r.session_id))
       OR (v_number IS NOT NULL AND coalesce(r.payment_session_id,r.session_id)=v_session.id))),'[]'::jsonb)) INTO v_detail
   FROM public.orders o WHERE o.id=v_order.id;
   INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    VALUES(public.get_current_profile_id(),'pos.receipt.lookup','order',v_order.id,
     jsonb_build_object('session_id',v_session.id,'order_number',v_number));
  END IF;
 END IF;
 RETURN jsonb_build_object('financial_visible',v_visible,'orders',v_orders,'detail',v_detail);
END $function$
;
REVOKE ALL ON FUNCTION public.get_pos_transaction_history_v2(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pos_transaction_history_v2(uuid,text) TO authenticated,service_role;
DROP FUNCTION public.get_pos_transaction_history_v1(uuid,text);
COMMENT ON FUNCTION public.get_pos_transaction_history_v2(uuid,text) IS
 'Tickets POS : cumuls après clôture ou Owner ; recherche exacte du propre shift auditée ; journées ADMIN protégées.';
