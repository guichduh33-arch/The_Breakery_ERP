-- Les approbations/payeurs historiques inconnus ne sont pas inventés.
CREATE OR REPLACE FUNCTION public._create_cash_import_expense_v2(p_entry jsonb, p_je uuid, p_profile uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE term expense_terms%ROWTYPE; expense uuid; amount numeric; d date := (p_entry->>'date')::date;
BEGIN
  SELECT * INTO STRICT term FROM expense_terms WHERE code=p_entry->>'expense_term_code' AND is_active;
  SELECT total_debit INTO STRICT amount FROM journal_entries WHERE id=p_je AND created_by=p_profile AND status='posted';
  INSERT INTO expenses(expense_number,category_id,amount,vat_amount,payment_method,description,remarks,
    expense_term_id,expense_date,status,is_historical_import,je_id,created_by,paid_at)
  VALUES('IMP-EXP-'||lpad(nextval('historical_expenses_seq')::text,6,'0'),term.category_id,amount,0,'cash',
    term.name,p_entry->>'remarks',term.id,d,'paid',true,p_je,p_profile,d::timestamptz)
  RETURNING id INTO expense;
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(p_profile,'expenses.imported',
    'expenses',expense,jsonb_build_object('source_key',p_entry->>'source_key','journal_entry_id',p_je,
      'historical',true,'expense_term_id',term.id,
      'original_approvals_unknown',true,'original_payer_unknown',true,'payment_time_precision','day'));
  RETURN expense;
END $function$
;
REVOKE ALL ON FUNCTION public._create_cash_import_expense_v2(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.apply_cash_journal_import_v4(p_payload jsonb, p_preview_hash text, p_manager_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  report jsonb; r jsonb; e jsonb; result jsonb; lines jsonb; profile uuid;
  created jsonb := '[]'; expense uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'accounting.je.create_manual')
    OR NOT has_permission(auth.uid(), 'accounting.cash.write') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  profile := _current_profile_id();
  IF profile IS NULL THEN RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501'; END IF;
  -- Retour, pas exception : les échecs PIN et leur verrouillage doivent persister.
  IF p_manager_pin IS NULL OR p_manager_pin !~ '^\d{6}$' THEN
    RETURN jsonb_build_object('ok',false,'error','pin_required');
  END IF;
  IF NOT _verify_pin_with_lockout(profile,p_manager_pin) THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_pin');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cash_journal_import_v1',0));
  report := preview_cash_journal_import_v3(p_payload);
  PERFORM 1 FROM journal_entries j WHERE j.id IN (
    SELECT (x->>'corrects_je_id')::uuid FROM jsonb_array_elements(report->'rows') x
    WHERE x->>'corrects_je_id' IS NOT NULL) ORDER BY j.id FOR SHARE;
  report := preview_cash_journal_import_v3(p_payload);
  IF p_preview_hash IS DISTINCT FROM report->>'preview_hash' THEN
    RAISE EXCEPTION 'preview_changed' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(report->'rows') WHERE value->>'state'='ready' LOOP
    SELECT value INTO e FROM jsonb_array_elements(p_payload->'entries') WHERE value->>'source_key'=r->>'source_key';
    IF r->>'corrects_je_id' IS NOT NULL THEN
      PERFORM 1 FROM journal_entries WHERE id=(r->>'corrects_je_id')::uuid FOR SHARE;
    END IF;
    SELECT jsonb_agg(x - 'account_code' - 'account_name') INTO lines FROM jsonb_array_elements(r->'lines') x;
    result := create_manual_je_v2(r->>'description',(r->>'date')::date,lines,p_manager_pin);
    IF result->>'je_id' IS NULL THEN RAISE EXCEPTION 'journal_creation_failed'; END IF;
    expense := NULL;
    IF e->>'kind' = 'expense' THEN
      expense := _create_cash_import_expense_v2(e,(result->>'je_id')::uuid,profile);
    END IF;
    INSERT INTO cash_journal_import_rows(source_key,entry_hash,source_name,source_sha256,
      journal_entry_id,corrects_je_id,created_by,expense_id) VALUES (
      r->>'source_key',encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex'),
      p_payload->>'source_name',p_payload->>'source_sha256',(result->>'je_id')::uuid,
      (r->>'corrects_je_id')::uuid,profile,expense);
    created := created || jsonb_build_array(jsonb_build_object('source_key',r->>'source_key','journal_entry_id',result->>'je_id'));
  END LOOP;
  IF jsonb_array_length(created) > 0 THEN
    INSERT INTO audit_logs(actor_id,action,entity_type,metadata) VALUES(profile,'accounting.cash_imported',
      'journal_entries',jsonb_build_object('source_name',p_payload->>'source_name',
      'source_sha256',p_payload->>'source_sha256','preview_hash',p_preview_hash,'entries',created));
  END IF;
  RETURN jsonb_build_object('ok',true,'created',jsonb_array_length(created),
    'already_imported',(report->>'already_imported')::integer,'entries',created);
END $function$
;
DROP FUNCTION public.apply_cash_journal_import_v3(jsonb,text,text);
DROP FUNCTION public._create_cash_import_expense_v1(jsonb,uuid,uuid);
REVOKE ALL ON FUNCTION public.apply_cash_journal_import_v4(jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cash_journal_import_v4(jsonb,text,text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
