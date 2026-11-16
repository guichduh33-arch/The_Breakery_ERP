-- S1-02 — Rattrapage production : import de journal de caisse et compte d'attente bancaire.
--
-- Le back-office déployé appelle quatre RPC que la production n'a jamais reçues :
-- bank_reconciliation_post_v5, bank_reconciliation_clearing_v3,
-- preview_cash_journal_import_v3 et apply_cash_journal_import_v4. Elles existent en
-- dev, créées par 20261030000005, 0006, 0008, 0010 et 0013. Ces fichiers rejouent
-- un historique (v1 → v2 → …) qui n'a pas de sens en production ; ce paquet installe
-- directement l'état final.
--
-- Corps des fonctions : copiés des fichiers du dépôt, puis vérifiés égaux au corps
-- live du dev (empreinte md5 de prosrc, retours chariot retirés) avant écriture.
--
-- Idempotent : sur une base qui porte déjà ces objets (dev, rejeu historique),
-- CREATE TABLE IF NOT EXISTS ne fait rien, CREATE OR REPLACE réécrit le même corps,
-- les DROP ... IF EXISTS ne trouvent rien.
--
-- Toutes les dépendances ont été relues en production le 2026-11-09 : tables
-- bancaires, expense_terms, historical_expenses_seq, pgcrypto, comptes 1110-1118,
-- 2141, 6111, permissions et fonctions auxiliaires (_bank_*, create_manual_je_v2,
-- _verify_pin_with_lockout, request_has_active_pin_session_v1).

-- 1. Table de traçabilité de l'import (état final dev, colonne expense_id comprise).
CREATE TABLE IF NOT EXISTS public.cash_journal_import_rows (
  source_key text PRIMARY KEY CHECK (length(source_key) BETWEEN 1 AND 160),
  entry_hash text NOT NULL,
  source_name text NOT NULL,
  source_sha256 text NOT NULL,
  journal_entry_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id),
  corrects_je_id uuid UNIQUE REFERENCES public.journal_entries(id),
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expense_id uuid UNIQUE REFERENCES public.expenses(id)
);
ALTER TABLE public.cash_journal_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_journal_import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cash_journal_import_rows TO authenticated;
DROP POLICY IF EXISTS cash_import_read ON public.cash_journal_import_rows;
CREATE POLICY cash_import_read ON public.cash_journal_import_rows FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'accounting.je.create_manual')
    AND public.has_permission(auth.uid(), 'accounting.cash.write'));
DROP POLICY IF EXISTS pin_session_required ON public.cash_journal_import_rows;
CREATE POLICY pin_session_required ON public.cash_journal_import_rows AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT public.request_has_active_pin_session_v1())) WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));

-- 2. Fonctions, état final du dev.
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

CREATE OR REPLACE FUNCTION public.preview_cash_journal_import_v3(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    IF e->>'kind' = 'expense' THEN
      IF NOT has_permission(auth.uid(),'expenses.create') THEN
        RAISE EXCEPTION 'expenses_create_required' USING ERRCODE='42501';
      END IF;
      IF coalesce(length(e->>'remarks'),0) > 2000
        OR NOT EXISTS (
          SELECT 1 FROM expense_terms et JOIN expense_categories ec ON ec.id=et.category_id
          JOIN accounts ac ON ac.id=ec.account_id
          WHERE et.code=e->>'expense_term_code' AND et.is_active AND ec.is_active
            AND et.name=e->>'description' AND jsonb_array_length(resolved)=2
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(resolved) rl WHERE rl->>'account_code'=ac.code AND (rl->>'debit')::numeric=td)
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(resolved) rl WHERE rl->>'account_code'='1111' AND (rl->>'credit')::numeric=td))
        OR e->>'corrects_je_id' IS NOT NULL THEN
        RAISE EXCEPTION 'invalid_historical_expense: %', k USING ERRCODE='22023';
      END IF;
    END IF;
    correction := nullif(e->>'corrects_je_id','')::uuid;
    IF correction IS NOT NULL THEN
      SELECT sum(jl.credit) INTO original_amount FROM journal_entry_lines jl
        JOIN accounts acc ON acc.id=jl.account_id JOIN journal_entries j ON j.id=jl.journal_entry_id
        WHERE j.id=correction AND j.status='posted' AND j.reference_type='purchase_payment'
          AND j.entry_date=d AND acc.code='1110';
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
END $function$;

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

CREATE OR REPLACE FUNCTION public.bank_reconciliation_clearing_v3(p_reconciliation_id uuid, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor uuid:=public._bank_actor('accounting.bank.read');rec public.bank_reconciliations;r jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_page_size' USING ERRCODE='22023'; END IF;
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=p_reconciliation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO r FROM (
  SELECT l.id,l.account_id,a.code account_code,l.journal_entry_id,l.debit,l.credit,l.debit-l.credit amount,
   l.description,j.entry_date,j.entry_number,j.reference_type,j.reference_id
  FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
  JOIN public.journal_entries j ON j.id=l.journal_entry_id
  WHERE a.code IN ('1115','1116') AND a.is_active AND a.is_postable AND a.deleted_at IS NULL
   AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=rec.period_end AND (p_after IS NULL OR l.id>p_after)
   AND j.reference_type IN ('sale','sale_refund','sale_void','pos_outstanding_payment','b2b_payment')
   AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_clearing_claims c WHERE c.gl_line_id=l.id)
  ORDER BY l.id LIMIT p_limit) t;
 PERFORM public._bank_audit(actor,'accounting.bank.clearing_read',rec.id);
 RETURN jsonb_build_object('items',r,'next_after',CASE WHEN jsonb_array_length(r)=p_limit THEN r->-1->>'id' END);
END $function$;

CREATE OR REPLACE FUNCTION public.bank_reconciliation_post_v5(p_reconciliation_id uuid, p_bank_line_ids uuid[], p_clearing_line_ids uuid[], p_counter_account_id uuid, p_fee_amount numeric, p_entry_date date, p_description text, p_manager_pin text, p_idempotency_key uuid, p_kind text DEFAULT 'settlement'::text, p_bank_gl_line_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 actor uuid:=public._bank_actor('accounting.bank.settle');rec public.bank_reconciliations;
 payload jsonb:=jsonb_build_object('reconciliation_id',p_reconciliation_id,'bank_line_ids',p_bank_line_ids,
  'clearing_line_ids',p_clearing_line_ids,'counter_account_id',p_counter_account_id,'fee_amount',p_fee_amount,
  'entry_date',p_entry_date,'description',p_description,'kind',p_kind,'bank_gl_line_ids',p_bank_gl_line_ids);
 replay jsonb;result jsonb;je_result jsonb;lines jsonb:='[]';bank_sum numeric;clearing_sum numeric;fee numeric;
 bank_entry_amount numeric;bank_source_sum numeric;matched_gl_ids uuid[];
 cnt integer;line record;entry_id uuid:=gen_random_uuid();je_id uuid;bank_gl_id uuid;match_result jsonb;
BEGIN
 replay:=public._bank_replay(p_idempotency_key,'post',actor,payload);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 -- Le créateur existant exige aussi son droit dédié ; aucun élargissement implicite.
 IF NOT public.has_permission(auth.uid(),'accounting.je.create_manual') THEN
  RAISE EXCEPTION 'manual_je_permission_required' USING ERRCODE='42501'; END IF;
 PERFORM public._bank_actor('accounting.bank.manage');
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=p_reconciliation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE='P0002'; END IF;
 -- Profil déjà verrouillé par _bank_actor ; alignement avec les clôtures fiscales.
 PERFORM 1 FROM public.fiscal_periods WHERE p_entry_date BETWEEN period_start AND period_end
  ORDER BY period_start,id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-account:'||rec.account_id::text,0));
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=rec.id FOR UPDATE;
 IF rec.status<>'draft' THEN RAISE EXCEPTION 'reconciliation_finalized' USING ERRCODE='22023'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('settlement','fee','interest','net_fee') OR p_entry_date IS NULL OR
  p_entry_date NOT BETWEEN rec.period_start AND rec.period_end OR
  coalesce(length(trim(p_description)),0) NOT BETWEEN 3 AND 1000 THEN
  RAISE EXCEPTION 'invalid_bank_posting' USING ERRCODE='22023'; END IF;
 fee:=public._bank_money(to_jsonb(p_fee_amount));
 IF fee<0 THEN RAISE EXCEPTION 'negative_actual_fee' USING ERRCODE='22023'; END IF;
 IF coalesce(cardinality(p_bank_line_ids),0) NOT BETWEEN 1 AND 1000 OR
  cardinality(p_bank_line_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_bank_line_ids) x) OR
  p_clearing_line_ids IS NULL OR cardinality(p_clearing_line_ids)>1000 OR
  cardinality(p_clearing_line_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_clearing_line_ids) x) THEN
  RAISE EXCEPTION 'unique_posting_lines_required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.accounts WHERE id=rec.account_id AND code IN ('1112','1113')
  AND is_active AND is_postable AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'eligible_bank_account_required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.bank_statement_lines l WHERE l.id=ANY(p_bank_line_ids) ORDER BY l.id FOR UPDATE;
 SELECT count(*),sum(l.amount) INTO cnt,bank_sum FROM public.bank_statement_lines l
 WHERE l.id=ANY(p_bank_line_ids) AND l.reconciliation_id=rec.id;
 IF cnt<>cardinality(p_bank_line_ids) OR bank_sum=0 OR
  EXISTS(SELECT 1 FROM public.bank_reconciliation_bank_claims WHERE bank_line_id=ANY(p_bank_line_ids)) OR
  EXISTS(SELECT 1 FROM public.bank_reconciliation_entry_bank_claims WHERE bank_line_id=ANY(p_bank_line_ids)) THEN
  RAISE EXCEPTION 'bank_line_unavailable_for_posting' USING ERRCODE='22023'; END IF;
 bank_entry_amount:=bank_sum;
 IF p_bank_gl_line_ids IS NULL OR cardinality(p_bank_gl_line_ids)>1000 OR
  cardinality(p_bank_gl_line_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_bank_gl_line_ids) x) OR
  (p_kind<>'net_fee' AND cardinality(p_bank_gl_line_ids)<>0) THEN
  RAISE EXCEPTION 'unique_bank_gl_sources_required' USING ERRCODE='22023'; END IF;
 IF p_kind='net_fee' THEN
  IF cardinality(p_bank_gl_line_ids)=0 OR cardinality(p_clearing_line_ids)<>0 OR bank_sum<=0 OR fee<=0 THEN
   RAISE EXCEPTION 'net_fee_sources_required' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.journal_entries j WHERE j.id IN
   (SELECT journal_entry_id FROM public.journal_entry_lines WHERE id=ANY(p_bank_gl_line_ids)) ORDER BY j.id FOR UPDATE;
  PERFORM 1 FROM public.journal_entry_lines l WHERE l.id=ANY(p_bank_gl_line_ids) ORDER BY l.id FOR UPDATE;
  SELECT count(*),sum(l.debit-l.credit) INTO cnt,bank_source_sum FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE l.id=ANY(p_bank_gl_line_ids)
   AND l.account_id=rec.account_id AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=p_entry_date
   AND (j.entry_date>=rec.period_start OR EXISTS(SELECT 1 FROM public.bank_reconciliation_transit t
    JOIN public.bank_reconciliations prior ON prior.id=t.reconciliation_id WHERE t.gl_line_id=l.id
    AND prior.account_id=rec.account_id AND prior.status='finalized' AND prior.period_end<rec.period_start))
   AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_entries e WHERE e.journal_entry_id=j.id);
  IF cnt<>cardinality(p_bank_gl_line_ids) OR
   EXISTS(SELECT 1 FROM public.bank_reconciliation_gl_claims WHERE gl_line_id=ANY(p_bank_gl_line_ids)) OR
   EXISTS(SELECT 1 FROM public.bank_reconciliation_net_fee_claims WHERE gl_line_id=ANY(p_bank_gl_line_ids)) THEN
   RAISE EXCEPTION 'net_fee_gl_source_unavailable' USING ERRCODE='22023'; END IF;
  IF bank_sum<>bank_source_sum-fee THEN RAISE EXCEPTION 'net_fee_amount_mismatch' USING ERRCODE='22023'; END IF;
  bank_entry_amount:=-fee;
 ELSIF p_kind='settlement' THEN
  IF cardinality(p_clearing_line_ids)=0 THEN RAISE EXCEPTION 'clearing_lines_required' USING ERRCODE='22023'; END IF;
  -- Verrous déterministes entre deux banques et les remboursements négatifs.
  PERFORM 1 FROM public.journal_entries j WHERE j.id IN
   (SELECT journal_entry_id FROM public.journal_entry_lines WHERE id=ANY(p_clearing_line_ids)) ORDER BY j.id FOR UPDATE;
  PERFORM 1 FROM public.journal_entry_lines l WHERE l.id=ANY(p_clearing_line_ids) ORDER BY l.id FOR UPDATE;
  PERFORM 1 FROM public.accounts a WHERE a.id IN
   (SELECT account_id FROM public.journal_entry_lines WHERE id=ANY(p_clearing_line_ids)) ORDER BY a.id FOR SHARE;
  SELECT count(*),sum(l.debit-l.credit) INTO cnt,clearing_sum FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id=l.journal_entry_id JOIN public.accounts a ON a.id=l.account_id
  WHERE l.id=ANY(p_clearing_line_ids) AND a.code IN ('1115','1116') AND a.is_active AND a.is_postable
   AND a.deleted_at IS NULL AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=p_entry_date
   AND j.reference_type IN ('sale','sale_void','sale_refund','pos_outstanding_payment','b2b_payment');
  IF cnt<>cardinality(p_clearing_line_ids) OR
   EXISTS(SELECT 1 FROM public.bank_reconciliation_clearing_claims WHERE gl_line_id=ANY(p_clearing_line_ids)) THEN
   RAISE EXCEPTION 'clearing_line_unavailable' USING ERRCODE='22023'; END IF;
  IF bank_sum<>clearing_sum-fee THEN RAISE EXCEPTION 'settlement_net_mismatch' USING ERRCODE='22023'; END IF;
  FOR line IN SELECT l.account_id,sum(l.debit-l.credit) amount FROM public.journal_entry_lines l
   WHERE l.id=ANY(p_clearing_line_ids) GROUP BY l.account_id ORDER BY l.account_id LOOP
   IF line.amount<>0 THEN
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',line.account_id,
     'debit',greatest(-line.amount,0),'credit',greatest(line.amount,0),'description',p_description));
   END IF;
  END LOOP;
 ELSE
  IF cardinality(p_clearing_line_ids)<>0 OR fee<>0 OR
   (p_kind='fee' AND bank_sum>=0) OR (p_kind='interest' AND bank_sum<=0) THEN
   RAISE EXCEPTION 'invalid_adjustment_direction' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_kind<>'settlement' OR fee>0 THEN
  PERFORM 1 FROM public.accounts WHERE id=p_counter_account_id AND is_active AND is_postable AND deleted_at IS NULL
   AND account_class=CASE WHEN p_kind='interest' THEN 4 ELSE 6 END FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'explicit_counter_account_required' USING ERRCODE='22023'; END IF;
  lines:=lines||jsonb_build_array(jsonb_build_object('account_id',p_counter_account_id,
   'debit',CASE WHEN p_kind='interest' THEN 0 WHEN p_kind='fee' THEN -bank_sum ELSE fee END,
   'credit',CASE WHEN p_kind='interest' THEN bank_sum ELSE 0 END,'description',p_description));
 END IF;
 lines:=lines||jsonb_build_array(jsonb_build_object('account_id',rec.account_id,
  'debit',greatest(bank_entry_amount,0),'credit',greatest(-bank_entry_amount,0),'description',p_description));
 -- Le refus JSON laisse commiter le compteur de PIN. Aucun claim ni JE avant cet appel.
 je_result:=public.create_manual_je_v2(p_description,p_entry_date,lines,p_manager_pin);
 IF je_result->>'ok'='false' THEN RETURN je_result; END IF;
 je_id:=(je_result->>'je_id')::uuid;
 SELECT l.id INTO STRICT bank_gl_id FROM public.journal_entry_lines l
  WHERE l.journal_entry_id=je_id AND l.account_id=rec.account_id;
 INSERT INTO public.bank_reconciliation_entries(id,reconciliation_id,kind,bank_line_ids,clearing_line_ids,
  journal_entry_id,bank_gl_line_id,fee_amount,created_by,bank_gl_source_ids)
 VALUES(entry_id,rec.id,p_kind,p_bank_line_ids,p_clearing_line_ids,je_id,bank_gl_id,fee,actor,p_bank_gl_line_ids);
 INSERT INTO public.bank_reconciliation_clearing_claims SELECT x,entry_id FROM unnest(p_clearing_line_ids) x;
 INSERT INTO public.bank_reconciliation_entry_bank_claims SELECT x,entry_id FROM unnest(p_bank_line_ids) x;
 INSERT INTO public.bank_reconciliation_net_fee_claims SELECT x,entry_id FROM unnest(p_bank_gl_line_ids) x;
 -- Même transaction : émission du journal, claims clearing et liaison bancaire.
 matched_gl_ids:=p_bank_gl_line_ids||ARRAY[bank_gl_id];
 match_result:=public.bank_reconciliation_match_v2(rec.id,p_bank_line_ids,matched_gl_ids,entry_id);
 result:=jsonb_build_object('ok',true,'entry_id',entry_id,'je_id',je_id,'bank_gl_line_id',bank_gl_id,
  'match_id',match_result->'match_id','amount',bank_sum,'actual_fee',fee);
 PERFORM public._bank_audit(actor,'accounting.bank.posted',rec.id,payload||result);
 RETURN public._bank_remember(p_idempotency_key,'post',actor,payload,result);
END $function$;

-- 3. Versions remplacées : le dev ne les porte plus, aucun appelant ne les nomme.
DROP FUNCTION IF EXISTS public.bank_reconciliation_post_v4(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[]);
DROP FUNCTION IF EXISTS public.bank_reconciliation_clearing_v2(uuid,uuid,integer);

-- 4. Droits, à l'identique du dev. PUBLIC révoqué explicitement : anon en hérite sinon.
REVOKE ALL ON FUNCTION public._create_cash_import_expense_v2(jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._create_cash_import_expense_v2(jsonb,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.preview_cash_journal_import_v3(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_cash_journal_import_v3(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_cash_journal_import_v4(jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cash_journal_import_v4(jsonb,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bank_reconciliation_clearing_v3(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_clearing_v3(uuid,uuid,integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bank_reconciliation_post_v5(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_post_v5(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[]) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
