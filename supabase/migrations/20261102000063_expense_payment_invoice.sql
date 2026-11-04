-- Les droits d'ajout suivent le propriétaire, la gestion et le règlement effectif.
CREATE FUNCTION public.can_upload_expense_invoice_v1(p_expense_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND public.request_has_active_pin_session_v1() AND EXISTS(SELECT 1 FROM public.expenses e
  WHERE e.id=p_expense_id AND e.deleted_at IS NULL
   AND (e.status='draft' OR (e.status IN ('submitted','approved') AND NOT public._payment_invoice_valid_v1(
    'expense-receipts',e.receipt_url,'expenses/'||e.id||'/')))
   AND (public.has_permission(auth.uid(),'expenses.manage')
    OR (e.created_by=public._current_profile_id() AND public.has_permission(auth.uid(),'expenses.create'))
    OR (e.status IN ('submitted','approved') AND public.has_permission(auth.uid(),'expenses.pay'))))
$$;
REVOKE ALL ON FUNCTION public.can_upload_expense_invoice_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_upload_expense_invoice_v1(uuid) TO authenticated,service_role;

DROP POLICY IF EXISTS expense_receipts_insert ON storage.objects;
CREATE POLICY expense_receipts_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
 bucket_id='expense-receipts'
 AND name ~ '^expenses/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|pdf)$'
 AND public.can_upload_expense_invoice_v1(public.storage_path_to_expense_id(name))
);

CREATE OR REPLACE FUNCTION public.set_expense_receipt_v2(p_expense_id uuid, p_storage_path text DEFAULT NULL::text, p_expected_path text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_profile uuid; v_row public.expenses%ROWTYPE; v_path text := NULLIF(p_storage_path, '');
  v_metadata jsonb; v_owner text; v_mime text; v_request jsonb; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.request_has_active_pin_session_v1() THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  v_profile := public._current_profile_id();
  IF v_profile IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='28000'; END IF;
  IF NOT (public.has_permission(auth.uid(),'expenses.create')
          OR public.has_permission(auth.uid(),'expenses.manage')
          OR public.has_permission(auth.uid(),'expenses.pay')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.expenses WHERE id=p_expense_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE='P0002'; END IF;
  IF v_row.created_by IS DISTINCT FROM v_profile
     AND NOT public.has_permission(auth.uid(),'expenses.manage')
     AND NOT (v_row.status IN ('submitted','approved') AND public.has_permission(auth.uid(),'expenses.pay')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'receipt_key_required' USING ERRCODE='22023';
  END IF;
  v_request:=jsonb_build_object('storage_path',v_path,'expected_path',NULLIF(p_expected_path,''));
  v_result:=public._read_expense_receipt_v1(p_idempotency_key,v_profile,v_row.id,v_request);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  -- Le verrou de ligne sérialise la soumission et les changements de référence.
  BEGIN
  IF NULLIF(v_row.receipt_url,'') IS NOT DISTINCT FROM v_path THEN
    v_result:=jsonb_build_object('expense_id',v_row.id,'receipt_path',v_path,'applied',true,'idempotent_replay',true);
    INSERT INTO public.expense_receipt_results(idempotency_key,actor_id,expense_id,request_payload,result)
    VALUES(p_idempotency_key,v_profile,v_row.id,v_request,v_result);
    RETURN v_result;
  END IF;
  IF NOT public.can_upload_expense_invoice_v1(v_row.id)
     OR (v_row.status <> 'draft' AND (v_path IS NULL OR v_path !~ '[.](jpg|jpeg|pdf)$'))
     OR NULLIF(v_row.receipt_url,'') IS DISTINCT FROM NULLIF(p_expected_path,'') THEN
    -- Sous verrou, l'absence de résultat prouve que cette clé n'a jamais modifié la référence.
    v_result:=jsonb_build_object('expense_id',v_row.id,'receipt_path',v_row.receipt_url,
      'applied',false,'idempotent_replay',false,
      'reason',CASE WHEN NOT public.can_upload_expense_invoice_v1(v_row.id)
       OR (v_row.status<>'draft' AND (v_path IS NULL OR v_path !~ '[.](jpg|jpeg|pdf)$')) THEN 'receipt_requires_draft' ELSE 'receipt_changed' END);
    INSERT INTO public.expense_receipt_results(idempotency_key,actor_id,expense_id,request_payload,result)
    VALUES(p_idempotency_key,v_profile,v_row.id,v_request,v_result);
    RETURN v_result;
  END IF;
  IF v_path IS NOT NULL THEN
    IF v_path !~ '^expenses/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|pdf)$'
       OR public.storage_path_to_expense_id(v_path) IS DISTINCT FROM v_row.id THEN
      RAISE EXCEPTION 'invalid_receipt_path' USING ERRCODE='22023';
    END IF;
    IF split_part(split_part(v_path,'/',3),'.',1)::uuid IS DISTINCT FROM p_idempotency_key THEN
      RAISE EXCEPTION 'receipt_path_key_mismatch' USING ERRCODE='22023';
    END IF;
    SELECT metadata,COALESCE(NULLIF(owner_id,''),owner::text) INTO v_metadata,v_owner
    FROM storage.objects WHERE bucket_id='expense-receipts' AND name=v_path
      AND archived_at IS NULL AND NOT COALESCE(is_delete_marker,false);
    IF NOT FOUND THEN RAISE EXCEPTION 'receipt_object_not_found' USING ERRCODE='P0002'; END IF;
    IF v_owner IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'receipt_object_owner_mismatch' USING ERRCODE='42501';
    END IF;
    v_mime := v_metadata->>'mimetype';
    IF v_mime IS NULL OR v_mime NOT IN ('image/jpeg','image/png','image/webp','application/pdf')
       OR COALESCE(v_metadata->>'size','') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_receipt_file' USING ERRCODE='22023';
    END IF;
    IF (v_metadata->>'size')::numeric NOT BETWEEN 1 AND 5242880
       OR (v_mime='image/jpeg' AND v_path !~ '[.](jpg|jpeg)$')
       OR (v_mime='image/png' AND v_path !~ '[.]png$')
       OR (v_mime='image/webp' AND v_path !~ '[.]webp$')
       OR (v_mime='application/pdf' AND v_path !~ '[.]pdf$') THEN
      RAISE EXCEPTION 'invalid_receipt_file' USING ERRCODE='22023';
    END IF;
  END IF;
  UPDATE public.expenses SET receipt_url=v_path WHERE id=v_row.id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
  VALUES(v_profile,'expense.receipt_updated','expense',v_row.id,
    jsonb_build_object('expense_number',v_row.expense_number),
    jsonb_build_object('receipt_url',jsonb_build_object('from',v_row.receipt_url,'to',v_path)));
  v_result:=jsonb_build_object('expense_id',v_row.id,'receipt_path',v_path,'applied',true,'idempotent_replay',false);
  INSERT INTO public.expense_receipt_results(idempotency_key,actor_id,expense_id,request_payload,result)
  VALUES(p_idempotency_key,v_profile,v_row.id,v_request,v_result);
  RETURN v_result;
  EXCEPTION WHEN unique_violation THEN
    v_result:=public._read_expense_receipt_v1(p_idempotency_key,v_profile,v_row.id,v_request);
    IF v_result IS NULL THEN RAISE; END IF;
    RETURN v_result;
  END;
END $function$
;
CREATE OR REPLACE FUNCTION public.pay_expense_v5(p_expense_id uuid, p_payment_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_row            expenses%ROWTYPE;
  v_je_id          UUID;
  v_entry_no       TEXT;
  v_ap_acc         UUID;
  v_cash_acc       UUID;
  v_method         TEXT;
  v_credit_key     TEXT;
  v_was_credit     BOOLEAN;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'pay_expense_v5: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.pay')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'pay_expense_v5: missing permission expenses.pay' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'pay_expense_v5: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_expense_v5: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'pay_expense_v5: expense % is not approved (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_row.invoice_exempt AND NOT public._payment_invoice_valid_v1(
    'expense-receipts',v_row.receipt_url,'expenses/'||v_row.id||'/') THEN
    RAISE EXCEPTION 'invoice_required_before_payment' USING ERRCODE='22023';
  END IF;

  v_was_credit := (v_row.payment_method = 'credit');
  v_method := v_row.payment_method;
  IF NOT v_was_credit AND p_payment_method IS NOT NULL
     AND p_payment_method IS DISTINCT FROM v_row.payment_method THEN
    RAISE EXCEPTION 'payment_method_locked' USING ERRCODE = '22023';
  END IF;

  IF v_was_credit THEN
    PERFORM check_fiscal_period_open(CURRENT_DATE);

    -- 2026-09-09 (audit finding n°4) : le compte crédité suit le moyen de règlement.
    v_method     := COALESCE(p_payment_method, 'cash');
    IF lower(v_method) = 'credit' THEN
      RAISE EXCEPTION 'pay_expense_v5: cannot settle expense % with method credit', p_expense_id
        USING ERRCODE = '22023';
    END IF;
    v_credit_key := _expense_settlement_mapping_key(v_method);
    IF v_credit_key IS NULL THEN
      RAISE EXCEPTION 'pay_expense_v5: unknown payment method %', v_method USING ERRCODE = '22023';
    END IF;

    v_ap_acc   := resolve_mapping_account('EXPENSE_AP');
    v_cash_acc := resolve_mapping_account(v_credit_key);
    v_entry_no := next_journal_entry_number(CURRENT_DATE);

    -- journal_entries.created_by référence user_profiles(id), pas auth.users(id).
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, CURRENT_DATE,
      'Expense payment ' || v_row.expense_number,
      'expense_payment', v_row.id,
      'posted', v_row.amount, v_row.amount, v_caller_profile
    )
    RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_ap_acc,   v_row.amount, 0,            'Clear AP'),
      (v_je_id, v_cash_acc, 0,            v_row.amount, 'Settled by ' || lower(v_method));

    UPDATE expenses
       SET status = 'paid',
           paid_by = v_caller_profile,
           paid_at = now(),
           payment_je_id = v_je_id,
           payment_method = v_method
     WHERE id = p_expense_id;
  ELSE
    UPDATE expenses
       SET status = 'paid',
           paid_by = v_caller_profile,
           paid_at = now(),
           payment_method = v_method
     WHERE id = p_expense_id;
  END IF;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_profile, 'expense.pay', 'expense', p_expense_id,
          jsonb_build_object('payment_je_id', v_je_id, 'was_credit', v_was_credit,
                             'payment_method', v_method));

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'payment_je_id', v_je_id,
    'status', 'paid',
    'was_credit', v_was_credit
  );
END $function$
;
DROP FUNCTION public.set_expense_receipt_v1(uuid,text,text,uuid);
REVOKE ALL ON FUNCTION public.set_expense_receipt_v2(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_expense_receipt_v2(uuid,text,text,uuid) TO authenticated,service_role;
DROP FUNCTION public.pay_expense_v4(uuid,text);
REVOKE ALL ON FUNCTION public.pay_expense_v5(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pay_expense_v5(uuid,text) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
