-- Les parsers CSV/Excel fournissent des lignes normalisées ; le serveur revalide tout.
CREATE FUNCTION public.bank_reconciliation_import_v1(
 p_payload jsonb,p_idempotency_key uuid,p_confirm boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=public._bank_actor('accounting.bank.manage');
 account uuid; rec public.bank_reconciliations; imp public.bank_statement_imports;
 row_data jsonb; rows_data jsonb:='[]'; warnings jsonb:='[]';
 d date; start_date date; end_date date; first_date date; last_date date;
 amount numeric; balance numeric; opening numeric; closing numeric; total numeric:=0;
 implied_opening numeric; checked_opening numeric; source_row integer; seen_rows integer[]:='{}';
 description text; reference text; fingerprint text; result jsonb; replay jsonb;
 payload_hash text:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 import_id uuid:=gen_random_uuid(); rec_id uuid; previous_date date;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'import_payload_required' USING ERRCODE='22023'; END IF;
 IF p_confirm IS NULL THEN RAISE EXCEPTION 'confirm_required' USING ERRCODE='22023'; END IF;
 replay:=public._bank_replay(p_idempotency_key,'import',actor,p_payload);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 account:=(p_payload->>'account_id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-account:'||account::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=account AND code IN ('1112','1113')
  AND is_active AND is_postable AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'eligible_bank_account_required' USING ERRCODE='22023'; END IF;
 IF p_payload->>'currency' IS DISTINCT FROM 'IDR' OR
  coalesce(p_payload->>'source_sha256','')!~'^[a-f0-9]{64}$' OR
  coalesce(length(p_payload->>'file_name'),0) NOT BETWEEN 1 AND 255 OR
  coalesce(length(p_payload->>'sheet_name'),0) NOT BETWEEN 1 AND 120 THEN
  RAISE EXCEPTION 'invalid_statement_source' USING ERRCODE='22023'; END IF;
 IF coalesce(p_payload->>'period_start','')!~'^\d{4}-\d{2}-\d{2}$' OR
  coalesce(p_payload->>'period_end','')!~'^\d{4}-\d{2}-\d{2}$' THEN
  RAISE EXCEPTION 'iso_period_required' USING ERRCODE='22023'; END IF;
 start_date:=(p_payload->>'period_start')::date;end_date:=(p_payload->>'period_end')::date;
 IF end_date<start_date OR end_date-start_date>366 THEN
  RAISE EXCEPTION 'invalid_statement_period' USING ERRCODE='22023'; END IF;
 opening:=public._bank_money(p_payload->'opening_balance',true);
 closing:=public._bank_money(p_payload->'closing_balance',true);
 IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'statement_rows_required' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 5000 THEN
  RAISE EXCEPTION 'statement_row_limit' USING ERRCODE='22023'; END IF;
 SELECT * INTO imp FROM public.bank_statement_imports WHERE account_id=account
  AND source_sha256=p_payload->>'source_sha256' AND sheet_name=p_payload->>'sheet_name';
 IF FOUND THEN
  IF imp.payload_sha256<>payload_hash THEN
   RAISE EXCEPTION 'source_already_imported_with_different_mapping' USING ERRCODE='22023'; END IF;
  result:=jsonb_build_object('ok',true,'reconciliation_id',imp.reconciliation_id,'import_id',imp.id,
   'already_imported',true,'row_count',jsonb_array_length(p_payload->'rows'));
  IF p_confirm THEN RETURN public._bank_remember(p_idempotency_key,'import',actor,p_payload,result); END IF;
  RETURN result;
 END IF;
 rec_id:=(p_payload->>'reconciliation_id')::uuid;
 IF rec_id IS NOT NULL THEN
  SELECT * INTO rec FROM public.bank_reconciliations WHERE id=rec_id FOR UPDATE;
  IF NOT FOUND OR rec.account_id<>account OR rec.status<>'draft' OR
   rec.period_start<>start_date OR rec.period_end<>end_date OR
   rec.opening_balance IS DISTINCT FROM opening OR rec.closing_balance IS DISTINCT FROM closing THEN
   RAISE EXCEPTION 'statement_header_conflict' USING ERRCODE='22023'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.bank_reconciliations WHERE account_id=account
   AND period_start<=end_date AND period_end>=start_date) THEN
   RAISE EXCEPTION 'reconciliation_period_overlap' USING ERRCODE='22023'; END IF;
  rec_id:=gen_random_uuid();
 END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(p_payload->'rows')
  ORDER BY (value->>'source_row')::integer LOOP
  IF coalesce(row_data->>'source_row','')!~'^[1-9][0-9]{0,8}$' THEN
   RAISE EXCEPTION 'invalid_source_row' USING ERRCODE='22023'; END IF;
  source_row:=(row_data->>'source_row')::integer;
  IF source_row=ANY(seen_rows) THEN RAISE EXCEPTION 'duplicate_source_row' USING ERRCODE='22023'; END IF;
  seen_rows:=array_append(seen_rows,source_row);
  IF coalesce(row_data->>'date','')!~'^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION 'iso_transaction_date_required' USING ERRCODE='22023'; END IF;
  d:=(row_data->>'date')::date;
  IF d<start_date OR d>end_date OR (previous_date IS NOT NULL AND d<previous_date) THEN
   RAISE EXCEPTION 'transaction_date_outside_period_or_order' USING ERRCODE='22023'; END IF;
  previous_date:=d;first_date:=least(first_date,d);last_date:=greatest(last_date,d);
  amount:=public._bank_money(row_data->'amount');balance:=public._bank_money(row_data->'balance',true);
  description:=trim(row_data->>'description');reference:=nullif(trim(row_data->>'reference'),'');
  IF amount=0 OR coalesce(length(description),0) NOT BETWEEN 1 AND 1000 OR length(reference)>255 THEN
   RAISE EXCEPTION 'invalid_statement_line' USING ERRCODE='22023'; END IF;
  total:=total+amount;
  IF balance IS NOT NULL THEN
   implied_opening:=balance-total;
   IF (opening IS NOT NULL AND opening<>implied_opening) OR
    (checked_opening IS NOT NULL AND checked_opening<>implied_opening) THEN
    RAISE EXCEPTION 'running_balance_mismatch' USING ERRCODE='22023'; END IF;
   checked_opening:=implied_opening;
  END IF;
  fingerprint:=encode(extensions.digest(jsonb_build_array(d,amount::numeric(14,2),
   lower(description),coalesce(reference,''))::text,'sha256'),'hex');
  IF EXISTS(SELECT 1 FROM public.bank_statement_lines l JOIN public.bank_reconciliations r ON r.id=l.reconciliation_id
   WHERE r.account_id=account AND (l.fingerprint=fingerprint OR
    (reference IS NOT NULL AND l.reference=reference))) THEN
   RAISE EXCEPTION 'potential_duplicate_existing_statement' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows_data) x WHERE x->>'fingerprint'=fingerprint OR
   (reference IS NOT NULL AND x->>'reference'=reference)) THEN
   warnings:=warnings||jsonb_build_array(jsonb_build_object('code','potential_duplicate_in_file','source_row',source_row));
  END IF;
  rows_data:=rows_data||jsonb_build_array(jsonb_build_object('source_row',source_row,'date',d,
   'amount',amount,'description',description,'reference',reference,'balance',balance,'fingerprint',fingerprint));
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.bank_statement_imports i WHERE i.reconciliation_id=rec_id
  AND i.first_date<=last_date AND i.last_date>=first_date) THEN
  RAISE EXCEPTION 'import_date_overlap' USING ERRCODE='22023'; END IF;
 -- Contrôle du relevé complet, y compris les fichiers déjà importés.
 SELECT total+coalesce(sum(l.amount),0) INTO total FROM public.bank_statement_lines l WHERE l.reconciliation_id=rec_id;
 IF cardinality(seen_rows)+(SELECT count(*) FROM public.bank_statement_lines WHERE reconciliation_id=rec_id)>5000 THEN
  RAISE EXCEPTION 'reconciliation_row_limit' USING ERRCODE='22023'; END IF;
 IF opening IS NOT NULL AND closing IS NOT NULL AND opening+total<>closing THEN
  RAISE EXCEPTION 'statement_balance_mismatch' USING ERRCODE='22023'; END IF;
 result:=jsonb_build_object('ok',true,'row_count',cardinality(seen_rows),'total',total,'warnings',warnings,
  'balance_check',CASE WHEN opening IS NULL OR closing IS NULL THEN 'unavailable' ELSE 'balanced' END,
  'confirm_required',NOT p_confirm);
 IF NOT p_confirm THEN
  PERFORM public._bank_audit(actor,'accounting.bank.preview',NULL,jsonb_build_object('source_sha256',p_payload->>'source_sha256'));
  RETURN result;
 END IF;
 IF jsonb_array_length(warnings)>0 AND coalesce(p_payload->>'duplicate_acknowledged','false')<>'true' THEN
  RAISE EXCEPTION 'duplicate_acknowledgement_required' USING ERRCODE='22023'; END IF;
 IF rec.id IS NULL THEN
  INSERT INTO public.bank_reconciliations(id,account_id,period_start,period_end,currency,opening_balance,closing_balance,created_by)
  VALUES(rec_id,account,start_date,end_date,'IDR',opening,closing,actor);
 END IF;
 INSERT INTO public.bank_statement_imports(id,reconciliation_id,account_id,source_sha256,sheet_name,file_name,
  payload_sha256,first_date,last_date)
 VALUES(import_id,rec_id,account,p_payload->>'source_sha256',p_payload->>'sheet_name',p_payload->>'file_name',
  payload_hash,first_date,last_date);
 INSERT INTO public.bank_statement_lines(reconciliation_id,import_id,source_row,transaction_date,amount,
  description,reference,balance,fingerprint)
 SELECT rec_id,import_id,(x->>'source_row')::integer,(x->>'date')::date,(x->>'amount')::numeric,
  x->>'description',x->>'reference',(x->>'balance')::numeric,x->>'fingerprint' FROM jsonb_array_elements(rows_data) x;
 result:=result||jsonb_build_object('reconciliation_id',rec_id,'import_id',import_id);
 PERFORM public._bank_audit(actor,'accounting.bank.imported',rec_id,result||jsonb_build_object('duplicates_acknowledged',p_payload->'duplicate_acknowledged'));
 RETURN public._bank_remember(p_idempotency_key,'import',actor,p_payload,result);
END $$;
REVOKE ALL ON FUNCTION public.bank_reconciliation_import_v1(jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_import_v1(jsonb,uuid,boolean) TO authenticated;
