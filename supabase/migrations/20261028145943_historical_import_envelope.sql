-- Contrat commun des imports historiques : validation pure, aucune écriture.
CREATE FUNCTION public._historical_import_number_v1(p_value jsonb, p_scale integer DEFAULT 2)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v_text text;
BEGIN
 IF p_scale IS NULL OR p_scale NOT BETWEEN 0 AND 6 OR jsonb_typeof(p_value) NOT IN ('number','string') THEN RETURN NULL; END IF;
 v_text:=p_value#>>'{}';
 IF v_text IS NULL OR v_text !~ '^[0-9]+([.][0-9]+)?$' OR length(v_text)>24 THEN RETURN NULL; END IF;
 IF v_text::numeric>=1e12 OR v_text::numeric<>round(v_text::numeric,p_scale) THEN RETURN NULL; END IF;
 RETURN v_text::numeric;
END $$;

CREATE FUNCTION public._historical_import_unit_price_v1(p_value jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v_text text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) NOT IN ('number','string') OR coalesce(v_text,'') !~ '^[0-9]+([.][0-9]+)?$'
  OR length(v_text)>128 THEN RETURN NULL; END IF;
 IF v_text::numeric>=1e12 THEN RETURN NULL; END IF;
 RETURN v_text::numeric;
END $$;

CREATE FUNCTION public._historical_import_timestamp_v1(p_value jsonb,p_date date,p_precision text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE v_text text:=p_value#>>'{}'; v_timestamp timestamptz;
BEGIN
 IF p_date IS NULL THEN RETURN NULL; END IF;
 IF p_value IS NULL OR p_value='null'::jsonb THEN
  IF p_precision IS NOT NULL AND p_precision<>'day' THEN RETURN NULL; END IF;
  RETURN p_date::timestamp AT TIME ZONE 'Asia/Makassar';
 END IF;
 IF p_precision IS DISTINCT FROM 'timestamp' OR jsonb_typeof(p_value)<>'string'
  OR coalesce(v_text,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN NULL; END IF;
 BEGIN v_timestamp:=v_text::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN RETURN NULL; END;
 IF (v_timestamp AT TIME ZONE 'Asia/Makassar')::date<>p_date THEN RETURN NULL; END IF;
 RETURN v_timestamp;
END $$;

CREATE FUNCTION public._historical_import_date_v1(p_value jsonb)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v_text text; v_date date;
BEGIN
 IF jsonb_typeof(p_value)<>'string' THEN RETURN NULL; END IF;
 v_text:=p_value#>>'{}';
 IF v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
 BEGIN v_date:=v_text::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL; END;
 IF to_char(v_date,'YYYY-MM-DD')<>v_text THEN RETURN NULL; END IF;
 RETURN v_date;
END $$;

CREATE FUNCTION public._historical_import_signed_number_v1(p_value jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v_text text:=p_value#>>'{}'; v_number numeric;
BEGIN
 IF jsonb_typeof(p_value) NOT IN ('number','string') OR coalesce(v_text,'') !~ '^-?[0-9]+([.][0-9]+)?$' THEN RETURN NULL; END IF;
 v_number:=_historical_import_number_v1(to_jsonb(ltrim(v_text,'-')));
 RETURN CASE WHEN left(v_text,1)='-' THEN -v_number ELSE v_number END;
END $$;

CREATE FUNCTION public._historical_import_envelope_errors_v1(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE
 v_errors jsonb:='[]'; v_kind text; v_from date; v_to date;
 v_file jsonb; v_doc jsonb; v_line jsonb; v_payment jsonb; v_allocation jsonb;
 v_i integer; v_j integer; v_k integer; v_path text; v_ref text;
 v_total numeric; v_net numeric; v_tax numeric; v_discount numeric; v_rounding numeric;
 v_line_total numeric; v_line_sum numeric; v_qty numeric; v_paid numeric; v_allocated numeric;
 v_seen text[]:='{}'; v_line_seen text[]; v_payment_seen text[]:='{}';
 v_source_hashes text[]:='{}'; v_doc_refs text[]:='{}'; v_payment_amount numeric;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RETURN jsonb_build_array(jsonb_build_object('path','$','code','object_required'));
 END IF;
 IF octet_length(p_payload::text)>2000000 THEN
  RETURN jsonb_build_array(jsonb_build_object('path','$','code','payload_too_large'));
 END IF;
 v_kind:=p_payload->>'kind';
 IF p_payload->'contract_version' IS DISTINCT FROM '1'::jsonb THEN
  v_errors:=v_errors||jsonb_build_object('path','contract_version','code','unsupported_version');
 END IF;
 IF v_kind IS NULL OR v_kind NOT IN ('sales','purchases') THEN
  v_errors:=v_errors||jsonb_build_object('path','kind','code','unsupported_kind');
 END IF;
 IF p_payload->>'currency' IS DISTINCT FROM 'IDR' THEN
  v_errors:=v_errors||jsonb_build_object('path','currency','code','idr_required');
 END IF;
 IF coalesce(length(btrim(p_payload->>'source_system')),0) NOT BETWEEN 1 AND 64
    OR coalesce(length(btrim(p_payload->>'batch_reference')),0) NOT BETWEEN 1 AND 128 THEN
  v_errors:=v_errors||jsonb_build_object('path','source_system/batch_reference','code','source_identity_required');
 END IF;
 v_from:=_historical_import_date_v1(p_payload->'period_start');
 v_to:=_historical_import_date_v1(p_payload->'period_end');
 IF v_from IS NULL OR v_to IS NULL OR v_to<v_from OR v_to-v_from>366 THEN
  v_errors:=v_errors||jsonb_build_object('path','period_start/period_end','code','invalid_period');
 END IF;
 IF jsonb_typeof(p_payload->'source_files') IS DISTINCT FROM 'array'
    OR jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'source_files')='array' THEN p_payload->'source_files' ELSE '[]'::jsonb END) NOT BETWEEN 1 AND 100 THEN
  RETURN v_errors||jsonb_build_object('path','source_files','code','source_files_required');
 END IF;
 FOR v_file,v_i IN SELECT value,ordinality::integer FROM jsonb_array_elements(p_payload->'source_files') WITH ORDINALITY LOOP
  IF jsonb_typeof(v_file)<>'object' OR coalesce(v_file->>'sha256','') !~ '^[a-f0-9]{64}$'
     OR coalesce(length(btrim(v_file->>'file_name')),0) NOT BETWEEN 1 AND 255
     OR coalesce(length(btrim(v_file->>'sheet_name')),0) NOT BETWEEN 1 AND 120 THEN
   v_errors:=v_errors||jsonb_build_object('path',format('source_files[%s]',v_i),'code','invalid_source_file');
  ELSE v_source_hashes:=array_append(v_source_hashes,v_file->>'sha256'); END IF;
 END LOOP;
 IF jsonb_typeof(p_payload->'documents') IS DISTINCT FROM 'array'
    OR jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'documents')='array' THEN p_payload->'documents' ELSE '[]'::jsonb END) NOT BETWEEN 1 AND 100 THEN
  RETURN v_errors||jsonb_build_object('path','documents','code','documents_required');
 END IF;
 SELECT array_agg(value->>'source_reference') INTO v_doc_refs FROM jsonb_array_elements(p_payload->'documents');
 FOR v_doc,v_i IN SELECT value,ordinality::integer FROM jsonb_array_elements(p_payload->'documents') WITH ORDINALITY LOOP
  v_path:=format('documents[%s]',v_i); v_ref:=v_doc->>'source_reference';
  IF jsonb_typeof(v_doc)<>'object' THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','object_required'); CONTINUE;
  END IF;
  IF coalesce(length(btrim(v_ref)),0) NOT BETWEEN 1 AND 128 OR v_ref=ANY(v_seen) THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path||'.source_reference','code','invalid_or_duplicate_reference');
  END IF;
  v_seen:=array_append(v_seen,v_ref);
  IF NOT coalesce((v_doc->>'source_sha256')=ANY(v_source_hashes),false)
     OR coalesce(v_doc->>'source_row','') !~ '^[1-9][0-9]{0,8}$' THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','source_provenance_required');
  END IF;
  IF v_doc->'reconciled' IS DISTINCT FROM 'true'::jsonb THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','document_not_reconciled');
  END IF;
  IF _historical_import_date_v1(v_doc->'document_date') IS NULL
     OR _historical_import_date_v1(v_doc->'document_date') NOT BETWEEN v_from AND v_to THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path||'.document_date','code','invalid_document_date');
  END IF;
  v_net:=_historical_import_number_v1(v_doc->'net_amount');
  v_tax:=_historical_import_number_v1(v_doc->'tax_amount');
  v_total:=_historical_import_number_v1(v_doc->'total_amount');
  v_discount:=_historical_import_number_v1(v_doc->'discount_amount');
  v_rounding:=_historical_import_signed_number_v1(coalesce(v_doc->'rounding_amount','0'::jsonb));
  IF v_net IS NULL OR v_tax IS NULL OR v_total IS NULL OR v_discount IS NULL OR v_rounding IS NULL OR v_net+v_tax<>v_total THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invalid_document_amounts');
  END IF;
  IF v_kind='sales' AND v_doc->>'tax_source' IS DISTINCT FROM 'sales_details_ticket' THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path||'.tax_source','code','ticket_tax_required');
  END IF;
  IF v_kind='sales' AND v_doc->>'customer_treatment'='owner_company_benefit' THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','owner_accounting_pending');
  END IF;
  IF jsonb_typeof(v_doc->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(CASE WHEN jsonb_typeof(v_doc->'lines')='array' THEN v_doc->'lines' ELSE '[]'::jsonb END) NOT BETWEEN 1 AND 200 THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path||'.lines','code','lines_required');
  ELSE
   v_line_seen:='{}'; v_line_sum:=0;
   FOR v_line,v_j IN SELECT value,ordinality::integer FROM jsonb_array_elements(v_doc->'lines') WITH ORDINALITY LOOP
    v_ref:=v_line->>'source_reference';
    IF jsonb_typeof(v_line)<>'object' OR coalesce(length(btrim(v_ref)),0) NOT BETWEEN 1 AND 128 OR v_ref=ANY(v_line_seen) THEN
     v_errors:=v_errors||jsonb_build_object('path',format('%s.lines[%s]',v_path,v_j),'code','invalid_or_duplicate_line');
    END IF;
    v_line_seen:=array_append(v_line_seen,v_ref);
    v_qty:=_historical_import_number_v1(v_line->'quantity',6);
    v_line_total:=_historical_import_number_v1(v_line->'line_total');
    IF v_qty IS NULL OR v_qty<=0 OR v_line_total IS NULL
       OR coalesce(v_line->>'product_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
       OR coalesce(length(btrim(v_line->>'unit')),0) NOT BETWEEN 1 AND 24
       OR v_line->'reconciled' IS DISTINCT FROM 'true'::jsonb THEN
     v_errors:=v_errors||jsonb_build_object('path',format('%s.lines[%s]',v_path,v_j),'code','invalid_or_unreconciled_line');
    END IF;
    v_line_sum:=v_line_sum+coalesce(v_line_total,0);
   END LOOP;
   -- Les totaux de lignes sont TTC avant la remise ticket, conservée séparément.
   IF v_line_sum-v_discount+v_rounding<>v_total THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path||'.lines','code','line_total_mismatch');
   END IF;
  END IF;
 END LOOP;
 IF jsonb_typeof(p_payload->'payments') IS DISTINCT FROM 'array' OR jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'payments')='array' THEN p_payload->'payments' ELSE '[]'::jsonb END)>500 THEN
  RETURN v_errors||jsonb_build_object('path','payments','code','payments_array_required');
 END IF;
 FOR v_payment,v_i IN SELECT value,ordinality::integer FROM jsonb_array_elements(p_payload->'payments') WITH ORDINALITY LOOP
  v_path:=format('payments[%s]',v_i); v_ref:=v_payment->>'source_reference';
  IF jsonb_typeof(v_payment)<>'object' OR coalesce(length(btrim(v_ref)),0) NOT BETWEEN 1 AND 128 OR v_ref=ANY(v_payment_seen) THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invalid_or_duplicate_payment');
  END IF;
  v_payment_seen:=array_append(v_payment_seen,v_ref);
  v_payment_amount:=_historical_import_number_v1(v_payment->'amount');
  IF v_payment_amount IS NULL OR v_payment_amount<=0 OR _historical_import_date_v1(v_payment->'payment_date') IS NULL
     OR _historical_import_date_v1(v_payment->'payment_date') NOT BETWEEN v_from AND v_to
     OR v_payment->'reconciled' IS DISTINCT FROM 'true'::jsonb THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invalid_or_unreconciled_payment');
  END IF;
  IF NOT coalesce((v_payment->>'source_sha256')=ANY(v_source_hashes),false)
     OR coalesce(v_payment->>'source_row','') !~ '^[1-9][0-9]{0,8}$' THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','source_provenance_required');
  END IF;
  IF NOT coalesce((v_payment->>'method')=ANY(enum_range(NULL::public.payment_method)::text[]),false)
     OR v_payment->>'method'='store_credit' THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path||'.method','code','unsupported_payment_method');
  END IF;
  IF jsonb_typeof(v_payment->'allocations') IS DISTINCT FROM 'array'
     OR jsonb_array_length(CASE WHEN jsonb_typeof(v_payment->'allocations')='array' THEN v_payment->'allocations' ELSE '[]'::jsonb END) NOT BETWEEN 1 AND 100 THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path||'.allocations','code','allocations_required');
  ELSE
   v_allocated:=0; v_seen:='{}';
   FOR v_allocation,v_j IN SELECT value,ordinality::integer FROM jsonb_array_elements(v_payment->'allocations') WITH ORDINALITY LOOP
    v_ref:=v_allocation->>'document_reference';
    v_paid:=_historical_import_number_v1(v_allocation->'amount');
    IF jsonb_typeof(v_allocation)<>'object' OR NOT coalesce(v_ref=ANY(v_doc_refs),false)
       OR v_ref=ANY(v_seen) OR v_paid IS NULL OR v_paid<=0 THEN
     v_errors:=v_errors||jsonb_build_object('path',format('%s.allocations[%s]',v_path,v_j),'code','invalid_allocation');
    END IF;
    v_seen:=array_append(v_seen,v_ref); v_allocated:=v_allocated+coalesce(v_paid,0);
   END LOOP;
   IF v_allocated<>v_payment_amount THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path||'.allocations','code','allocation_total_mismatch');
   END IF;
  END IF;
 END LOOP;
 FOR v_doc IN SELECT value FROM jsonb_array_elements(p_payload->'documents') LOOP
  SELECT coalesce(sum(_historical_import_number_v1(a.value->'amount')),0) INTO v_paid
   FROM jsonb_array_elements(p_payload->'payments') p,
        jsonb_array_elements(CASE WHEN jsonb_typeof(p.value->'allocations')='array' THEN p.value->'allocations' ELSE '[]'::jsonb END) a
   WHERE a.value->>'document_reference'=v_doc->>'source_reference';
  IF v_paid>_historical_import_number_v1(v_doc->'total_amount') THEN
   v_errors:=v_errors||jsonb_build_object('path',v_doc->>'source_reference','code','document_overallocated');
  END IF;
 END LOOP;
 RETURN v_errors;
END $$;

REVOKE ALL ON FUNCTION public._historical_import_number_v1(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_date_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_timestamp_v1(jsonb,date,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_unit_price_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_signed_number_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_envelope_errors_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
