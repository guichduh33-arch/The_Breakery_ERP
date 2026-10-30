-- Import de rapprochement : écritures manuelles existantes, PIN et rejeu durable.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE code='1118' AND
    (name <> 'Bank - Professional Expense Reserve' OR account_class <> 1
      OR account_type <> 'asset' OR balance_type <> 'debit' OR cash_flow_section <> 'none'
      OR NOT is_active OR NOT is_postable OR deleted_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'account_1118_conflict';
  END IF;
END $$;
INSERT INTO public.accounts(code,name,account_class,account_type,balance_type,cash_flow_section,is_active,is_postable,is_system)
SELECT '1118','Bank - Professional Expense Reserve',1,'asset','debit','none',true,true,false
WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE code='1118');
CREATE TABLE public.cash_journal_import_rows (
  source_key text PRIMARY KEY CHECK (length(source_key) BETWEEN 1 AND 160),
  entry_hash text NOT NULL,
  source_name text NOT NULL,
  source_sha256 text NOT NULL,
  journal_entry_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id),
  corrects_je_id uuid UNIQUE REFERENCES public.journal_entries(id),
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cash_journal_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_journal_import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cash_journal_import_rows TO authenticated;
CREATE POLICY cash_import_read ON public.cash_journal_import_rows FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'accounting.je.create_manual')
    AND public.has_permission(auth.uid(), 'accounting.cash.write'));

CREATE FUNCTION public.preview_cash_journal_import_v1(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e jsonb; l jsonb; a accounts%ROWTYPE; old cash_journal_import_rows%ROWTYPE;
  k text; d date; dr numeric; cr numeric; td numeric; tc numeric;
  cash_found boolean; resolved jsonb; rows jsonb := '[]'; impacts jsonb := '[]';
  entry_hash text; correction uuid; original_amount numeric; n integer := 0;
  skipped integer := 0; total numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'accounting.je.create_manual')
    OR NOT has_permission(auth.uid(), 'accounting.cash.write') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR p_payload->>'version' IS DISTINCT FROM '1'
    OR coalesce(length(trim(p_payload->>'source_name')),0) NOT BETWEEN 1 AND 200
    OR coalesce(p_payload->>'source_sha256','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_payload->'entries') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_import_envelope' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_payload->'entries') NOT BETWEEN 1 AND 200
    OR octet_length(p_payload::text) > 1000000 THEN
    RAISE EXCEPTION 'import_size_limit' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'entries') x
    GROUP BY x->>'source_key' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate_source_key' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_payload->'entries') LOOP
    k := e->>'source_key';
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR coalesce(length(trim(k)),0) NOT BETWEEN 1 AND 160
      OR coalesce(length(trim(e->>'description')),0) NOT BETWEEN 3 AND 500
      OR coalesce(e->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      OR jsonb_typeof(e->'lines') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_entry: %', k USING ERRCODE = '22023';
    END IF;
    d := (e->>'date')::date;
    IF d > current_date OR to_char(d,'YYYY-MM-DD') <> e->>'date' THEN
      RAISE EXCEPTION 'invalid_entry_date: %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(e->'lines') NOT BETWEEN 2 AND 20 THEN
      RAISE EXCEPTION 'invalid_line_count: %', k USING ERRCODE = '22023';
    END IF;
    entry_hash := encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex');
    SELECT * INTO old FROM cash_journal_import_rows WHERE source_key = k;
    IF FOUND THEN
      IF old.entry_hash <> entry_hash THEN
        RAISE EXCEPTION 'source_key_conflict: %', k USING ERRCODE = '22023';
      END IF;
      rows := rows || jsonb_build_array(jsonb_build_object('source_key',k,'date',d,
        'description',e->>'description','state','already_imported','journal_entry_id',old.journal_entry_id));
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    PERFORM check_fiscal_period_open(d);
    td := 0; tc := 0; cash_found := false; resolved := '[]';
    FOR l IN SELECT value FROM jsonb_array_elements(e->'lines') LOOP
      IF jsonb_typeof(l) IS DISTINCT FROM 'object'
        OR jsonb_typeof(l->'debit') IS DISTINCT FROM 'number'
        OR jsonb_typeof(l->'credit') IS DISTINCT FROM 'number'
        OR coalesce(length(l->>'description'),0) > 500 THEN
        RAISE EXCEPTION 'invalid_line: %', k USING ERRCODE = '22023';
      END IF;
      dr := (l->>'debit')::numeric; cr := (l->>'credit')::numeric;
      IF dr < 0 OR cr < 0 OR dr > 999999999999.99 OR cr > 999999999999.99
        OR dr <> round(dr,2) OR cr <> round(cr,2) OR (dr > 0) = (cr > 0) THEN
        RAISE EXCEPTION 'invalid_line_amount: %', k USING ERRCODE = '22023';
      END IF;
      SELECT * INTO a FROM accounts WHERE code = l->>'account_code' AND deleted_at IS NULL;
      IF NOT FOUND OR NOT a.is_active OR NOT a.is_postable THEN
        RAISE EXCEPTION 'account_unavailable: %', l->>'account_code' USING ERRCODE = '22023';
      END IF;
      cash_found := cash_found OR a.cash_flow_section = 'none';
      td := td + dr; tc := tc + cr;
      resolved := resolved || jsonb_build_array(jsonb_build_object('account_id',a.id,
        'account_code',a.code,'account_name',a.name,'debit',dr,'credit',cr,'description',l->>'description'));
    END LOOP;
    -- La constatation d'une dette salariale est admise ; pas de JE sans lien trésorerie sinon.
    IF NOT cash_found AND e->>'kind' IS DISTINCT FROM 'salary_accrual' THEN
      RAISE EXCEPTION 'cash_account_required: %', k USING ERRCODE = '22023';
    END IF;
    IF e->>'kind' = 'salary_accrual' AND (jsonb_array_length(resolved) <> 2
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(resolved) x WHERE x->>'account_code'='6111' AND (x->>'debit')::numeric > 0)
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(resolved) x WHERE x->>'account_code'='2141' AND (x->>'credit')::numeric > 0)) THEN
      RAISE EXCEPTION 'invalid_salary_accrual: %', k USING ERRCODE = '22023';
    END IF;
    IF td <> tc OR td > 999999999999.99 THEN
      RAISE EXCEPTION 'entry_unbalanced: %', k USING ERRCODE = '22023';
    END IF;
    correction := nullif(e->>'corrects_je_id','')::uuid;
    IF correction IS NOT NULL THEN
      SELECT sum(l.credit) INTO original_amount FROM journal_entry_lines l
        JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
        WHERE j.id=correction AND j.status='posted' AND j.reference_type='purchase_payment'
          AND j.entry_date=d AND a.code='1110';
      IF original_amount IS NULL OR original_amount <> td OR jsonb_array_length(resolved) <> 2
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(resolved) x WHERE x->>'account_code'='1110' AND (x->>'debit')::numeric=td)
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(resolved) x WHERE x->>'account_code'='1111' AND (x->>'credit')::numeric=td)
        OR EXISTS (SELECT 1 FROM cash_journal_import_rows WHERE corrects_je_id=correction)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(rows) x WHERE x->>'corrects_je_id'=correction::text) THEN
        RAISE EXCEPTION 'invalid_purchase_cash_correction: %', k USING ERRCODE = '22023';
      END IF;
    END IF;
    rows := rows || jsonb_build_array(jsonb_build_object('source_key',k,'date',d,
      'description',e->>'description','state','ready','lines',resolved,'total',td,'corrects_je_id',correction));
    impacts := impacts || resolved;
    n := n + 1; total := total + td;
  END LOOP;
  RETURN jsonb_build_object('preview_hash',encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex'),
    'ready',n,'already_imported',skipped,'total_debit',total,'total_credit',total,'rows',rows,
    'account_impacts',(SELECT coalesce(jsonb_agg(v ORDER BY v->>'account_code'),'[]'::jsonb) FROM (
      SELECT jsonb_build_object('account_code',x->>'account_code','account_name',x->>'account_name',
        'debit',sum((x->>'debit')::numeric),'credit',sum((x->>'credit')::numeric),
        'change',sum((x->>'debit')::numeric-(x->>'credit')::numeric)) v
      FROM jsonb_array_elements(impacts) x GROUP BY x->>'account_code',x->>'account_name') q));
END $$;

CREATE FUNCTION public.apply_cash_journal_import_v1(p_payload jsonb, p_preview_hash text, p_manager_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  report jsonb; r jsonb; e jsonb; result jsonb; lines jsonb; profile uuid;
  created jsonb := '[]';
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'accounting.je.create_manual')
    OR NOT has_permission(auth.uid(), 'accounting.cash.write') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  profile := _current_profile_id();
  IF profile IS NULL THEN RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501'; END IF;
  -- Retour, pas exception : les échecs PIN et leur verrouillage doivent persister.
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RETURN jsonb_build_object('ok',false,'error','pin_required');
  END IF;
  IF NOT _verify_pin_with_lockout(profile,p_manager_pin) THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_pin');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cash_journal_import_v1',0));
  report := preview_cash_journal_import_v1(p_payload);
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
    INSERT INTO cash_journal_import_rows(source_key,entry_hash,source_name,source_sha256,
      journal_entry_id,corrects_je_id,created_by) VALUES (
      r->>'source_key',encode(extensions.digest(convert_to(e::text,'UTF8'),'sha256'),'hex'),
      p_payload->>'source_name',p_payload->>'source_sha256',(result->>'je_id')::uuid,
      (r->>'corrects_je_id')::uuid,profile);
    created := created || jsonb_build_array(jsonb_build_object('source_key',r->>'source_key','journal_entry_id',result->>'je_id'));
  END LOOP;
  IF jsonb_array_length(created) > 0 THEN
    INSERT INTO audit_logs(actor_id,action,entity_type,metadata) VALUES(profile,'accounting.cash_imported',
      'journal_entries',jsonb_build_object('source_name',p_payload->>'source_name',
      'source_sha256',p_payload->>'source_sha256','preview_hash',p_preview_hash,'entries',created));
  END IF;
  RETURN jsonb_build_object('ok',true,'created',jsonb_array_length(created),
    'already_imported',(report->>'already_imported')::integer,'entries',created);
END $$;

REVOKE ALL ON FUNCTION public.preview_cash_journal_import_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_cash_journal_import_v1(jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_cash_journal_import_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cash_journal_import_v1(jsonb,text,text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
