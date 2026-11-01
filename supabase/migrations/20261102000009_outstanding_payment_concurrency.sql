CREATE OR REPLACE FUNCTION public.defer_pos_order_v2(p_order_id uuid, p_customer_id uuid, p_session_id uuid, p_idempotency_key uuid, p_loyalty_points_redeemed integer DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT NULL::text, p_discount_value numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text, p_discount_authorized_by uuid DEFAULT NULL::uuid, p_discount_auth_id uuid DEFAULT NULL::uuid, p_promotions jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid; v_saved pos_payment_attempt_keys; v_request jsonb; v_result jsonb; v_order orders;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'payments.process') THEN
    RAISE EXCEPTION 'permission_denied: payments.process' USING ERRCODE='P0003'; END IF;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id=auth.uid() AND deleted_at IS NULL AND is_active;
  IF v_actor IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'payment_identity_required' USING ERRCODE='22023'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'outstanding_requires_customer' USING ERRCODE='23514'; END IF;
  v_request := jsonb_build_object('operation','defer','order',p_order_id,'customer',p_customer_id,'session',p_session_id,
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
  v_result := pos_deferred_private.finalize_order_v2(p_order_id,NULL,p_customer_id,p_loyalty_points_redeemed,
    p_idempotency_key,p_discount_amount,p_discount_type,p_discount_value,p_discount_reason,
    p_discount_authorized_by,p_discount_auth_id,p_promotions,'[]',false);
  IF (v_result->>'total')::numeric<=0 THEN RAISE EXCEPTION 'outstanding_requires_positive_total' USING ERRCODE='23514'; END IF;
  v_result := v_result||jsonb_build_object('outstanding_due',(v_result->>'total')::numeric);
  INSERT INTO pos_payment_attempt_keys(key,order_id,actor_id,request,result)
    VALUES(p_idempotency_key,p_order_id,v_actor,v_request,v_result);
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata)
    VALUES(v_actor,'order.outstanding_created','orders',p_order_id,
      jsonb_build_object('customer_id',p_customer_id,'session_id',p_session_id,'amount',v_result->'total','idempotency_key',p_idempotency_key));
  RETURN v_result;
END $function$
;
CREATE OR REPLACE FUNCTION public.settle_pos_outstanding_v2(p_order_id uuid, p_method payment_method, p_amount numeric, p_idempotency_key uuid, p_session_id uuid DEFAULT NULL::uuid, p_expected_paid numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid; v_order orders; v_saved pos_payment_attempt_keys; v_request jsonb;
  v_paid numeric; v_due numeric; v_je uuid; v_result jsonb; v_account uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'payments.process') THEN
    RAISE EXCEPTION 'permission_denied: payments.process' USING ERRCODE='P0003'; END IF;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id=auth.uid() AND deleted_at IS NULL AND is_active;
  IF v_actor IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'payment_identity_required' USING ERRCODE='22023'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_amount<>round(p_amount,2) OR p_method IS NULL OR p_method NOT IN ('cash','edc','qris','transfer') THEN
    RAISE EXCEPTION 'invalid_outstanding_payment' USING ERRCODE='23514'; END IF;
  IF p_session_id IS NULL AND NOT has_permission(auth.uid(),'orders.read') THEN
    RAISE EXCEPTION 'backoffice_payment_not_allowed' USING ERRCODE='P0003'; END IF;
  v_request:=jsonb_build_object('operation','settle','order',p_order_id,'method',p_method,'amount',p_amount,'session',p_session_id);
  IF p_expected_paid IS NOT NULL THEN v_request:=v_request||jsonb_build_object('expected_paid',p_expected_paid); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  SELECT * INTO v_saved FROM pos_payment_attempt_keys WHERE key=p_idempotency_key;
  IF FOUND THEN
    IF v_saved.actor_id<>v_actor OR v_saved.request<>v_request THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
    RETURN v_saved.result||jsonb_build_object('idempotent_replay',true);
  END IF;
  IF p_session_id IS NOT NULL THEN
    PERFORM id FROM pos_sessions WHERE id=p_session_id AND status='open' AND opened_by=v_actor FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'no_open_shift' USING ERRCODE='P0001'; END IF;
  END IF;
  SELECT * INTO v_order FROM orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.outstanding_at IS NULL OR v_order.customer_id IS NULL
    OR v_order.status NOT IN ('draft','pending_payment') OR v_order.order_type='b2b' THEN
    RAISE EXCEPTION 'outstanding_order_changed' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(amount),0) INTO v_paid FROM order_payments WHERE order_id=p_order_id;
  IF p_expected_paid IS NOT NULL AND p_expected_paid IS DISTINCT FROM v_paid THEN
    RAISE EXCEPTION 'outstanding_balance_changed_refresh' USING ERRCODE='23514'; END IF;
  v_due:=v_order.total-v_paid;
  IF p_amount>v_due THEN RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE='23514'; END IF;
  PERFORM check_fiscal_period_open(current_date);
  PERFORM set_config('breakery.payment_origin',CASE WHEN p_session_id IS NULL THEN 'backoffice' ELSE 'pos' END,true);
  PERFORM set_config('breakery.payment_session_id',coalesce(p_session_id::text,''),true);
  PERFORM set_config('breakery.outstanding_settlement','true',true);
  INSERT INTO order_payments(order_id,method,amount,cash_received,change_given,session_id,reference)
    VALUES(p_order_id,p_method,p_amount,CASE WHEN p_method='cash' THEN p_amount END,0,p_session_id,p_idempotency_key::text);
  v_account:=CASE WHEN p_session_id IS NULL AND p_method='cash' THEN resolve_mapping_account('CASH_WALLET_UNDEPOSITED')
    ELSE resolve_mapping_account(_sale_payment_mapping_key_v1(p_method::text)) END;
  INSERT INTO journal_entries(entry_number,entry_date,description,reference_type,reference_id,status,total_debit,total_credit,created_by)
    VALUES(next_journal_entry_number(current_date),current_date,'Outstanding receipt '||v_order.order_number,
      'pos_outstanding_payment',p_idempotency_key,'posted',p_amount,p_amount,v_actor) RETURNING id INTO v_je;
  INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit,description) VALUES
    (v_je,v_account,p_amount,0,'Outstanding payment received'),
    (v_je,resolve_mapping_account('POS_RECEIVABLE'),0,p_amount,'Customer receivable settled');
  IF p_amount=v_due THEN
    UPDATE orders SET status='paid',paid_at=now(),updated_at=now() WHERE id=p_order_id;
  END IF;
  v_result:=jsonb_build_object('order_id',p_order_id,'order_number',v_order.order_number,
    'amount_received',p_amount,'remaining_due',v_due-p_amount,'session_id',p_session_id);
  INSERT INTO pos_payment_attempt_keys(key,order_id,actor_id,request,result)
    VALUES(p_idempotency_key,p_order_id,v_actor,v_request,v_result);
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata)
    VALUES(v_actor,'order.outstanding_payment','orders',p_order_id,
      v_result||jsonb_build_object('method',p_method,'idempotency_key',p_idempotency_key,'source',CASE WHEN p_session_id IS NULL THEN 'backoffice' ELSE 'pos' END));
  RETURN v_result;
END $function$
;
REVOKE ALL ON FUNCTION public.defer_pos_order_v2(uuid,uuid,uuid,uuid,integer,numeric,text,numeric,text,uuid,uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.settle_pos_outstanding_v2(uuid,payment_method,numeric,uuid,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.defer_pos_order_v2(uuid,uuid,uuid,uuid,integer,numeric,text,numeric,text,uuid,uuid,jsonb),public.settle_pos_outstanding_v2(uuid,payment_method,numeric,uuid,uuid,numeric) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
