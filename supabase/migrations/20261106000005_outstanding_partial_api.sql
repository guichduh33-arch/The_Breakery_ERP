-- Corps live DEV : un seul enregistrement atomique, versements et solde différé.
CREATE OR REPLACE FUNCTION public.defer_pos_order_v3(p_order_id uuid, p_customer_id uuid, p_session_id uuid, p_idempotency_key uuid, p_loyalty_points_redeemed integer DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT NULL::text, p_discount_value numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text, p_discount_authorized_by uuid DEFAULT NULL::uuid, p_discount_auth_id uuid DEFAULT NULL::uuid, p_promotions jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid; v_saved pos_payment_attempt_keys; v_request jsonb; v_result jsonb; v_order orders; v_tender jsonb; v_amount numeric; v_paid numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'payments.process') THEN
    RAISE EXCEPTION 'permission_denied: payments.process' USING ERRCODE='P0003'; END IF;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id=auth.uid() AND deleted_at IS NULL AND is_active;
  IF v_actor IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'payment_identity_required' USING ERRCODE='22023'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'outstanding_requires_customer' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_payments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payments)>5 THEN
    RAISE EXCEPTION 'invalid_tenders' USING ERRCODE='23514'; END IF;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_amount:=(v_tender->>'amount')::numeric;
    IF v_amount IS NULL OR v_amount<=0 OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<>round(v_amount,2)
      OR (v_tender->>'method') IS NULL THEN RAISE EXCEPTION 'invalid_tender' USING ERRCODE='23514'; END IF;
  END LOOP;
  v_request := jsonb_build_object('operation','defer','payments',p_payments,'order',p_order_id,'customer',p_customer_id,'session',p_session_id,
    'points',p_loyalty_points_redeemed,'discount',p_discount_amount,'discount_type',p_discount_type,
    'discount_value',p_discount_value,'discount_reason',p_discount_reason,'authorizer',p_discount_authorized_by,'promotions',p_promotions);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  SELECT * INTO v_saved FROM pos_payment_attempt_keys WHERE key=p_idempotency_key;
  IF FOUND THEN
    IF v_saved.actor_id<>v_actor OR v_saved.request<>v_request THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
    RETURN v_saved.result||jsonb_build_object('idempotent_replay',true);
  END IF;
  PERFORM id FROM pos_sessions WHERE id=p_session_id AND status='open' AND opened_by=v_actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_open_shift' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_order FROM orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.session_id IS DISTINCT FROM p_session_id
    OR v_order.outstanding_at IS NOT NULL OR v_order.order_type='b2b'
    OR v_order.financial_import_document_id IS NOT NULL OR v_order.is_historical_import
    OR EXISTS(SELECT 1 FROM order_payments WHERE order_id=p_order_id) THEN
    RAISE EXCEPTION 'order_not_available_for_outstanding' USING ERRCODE='23514'; END IF;
  PERFORM set_config('breakery.payment_session_id',p_session_id::text,true);
  PERFORM set_config('breakery.payment_origin','pos',true);
  v_result := pos_deferred_private.finalize_order_v3(p_order_id,NULL,p_customer_id,p_loyalty_points_redeemed,
    p_idempotency_key,p_discount_amount,p_discount_type,p_discount_value,p_discount_reason,
    p_discount_authorized_by,p_discount_auth_id,p_promotions,p_payments,false);
  IF (v_result->>'total')::numeric<=0 THEN RAISE EXCEPTION 'outstanding_requires_positive_total' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(amount),0) INTO v_paid FROM order_payments WHERE order_id=p_order_id;
  v_result := v_result||jsonb_build_object('outstanding_due',(v_result->>'total')::numeric-v_paid,
    'amount_received',v_paid,'amount_paid',v_paid,'remaining_due',(v_result->>'total')::numeric-v_paid);
  INSERT INTO pos_payment_attempt_keys(key,order_id,actor_id,request,result)
    VALUES(p_idempotency_key,p_order_id,v_actor,v_request,v_result);
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata)
    VALUES(v_actor,'order.outstanding_created','orders',p_order_id,
      jsonb_build_object('customer_id',p_customer_id,'session_id',p_session_id,'amount',v_result->'total','idempotency_key',p_idempotency_key));
  RETURN v_result;
END $function$
;
REVOKE ALL ON FUNCTION public.defer_pos_order_v3(uuid,uuid,uuid,uuid,integer,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.defer_pos_order_v3(uuid,uuid,uuid,uuid,integer,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb) TO authenticated,service_role;
DROP FUNCTION public.defer_pos_order_v2(uuid,uuid,uuid,uuid,integer,numeric,text,numeric,text,uuid,uuid,jsonb);
DROP FUNCTION pos_deferred_private.finalize_order_v2(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
