-- Ordre global : profil d'abord pour toutes les RPC, puis période avant compte/source JE pour post.
-- Corps live dev relus ; aucun changement des clôtures ni des permissions.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE OR REPLACE FUNCTION public._bank_actor(p_permission text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_actor uuid;
BEGIN
 IF NOT public.request_has_active_pin_session_v1() THEN
  RAISE EXCEPTION 'session_expired' USING ERRCODE='PT401';
 END IF;
 SELECT id INTO v_actor FROM public.user_profiles
 WHERE auth_user_id=auth.uid() AND deleted_at IS NULL AND is_active FOR UPDATE;
 -- Verrou de profil commun, avant clé/compte/période/table JE de tout appel bancaire.
 IF v_actor IS NULL OR NOT public.has_permission(auth.uid(),p_permission) OR NOT EXISTS (
  SELECT 1 FROM public.user_sessions WHERE id=(auth.jwt()->>'session_id')::uuid
   AND p_permission=ANY(permissions_snapshot)) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
 END IF;
 RETURN v_actor;
END $function$;
REVOKE ALL ON FUNCTION public._bank_actor(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.bank_reconciliation_post_v4(p_reconciliation_id uuid, p_bank_line_ids uuid[], p_clearing_line_ids uuid[], p_counter_account_id uuid, p_fee_amount numeric, p_entry_date date, p_description text, p_manager_pin text, p_idempotency_key uuid, p_kind text DEFAULT 'settlement'::text, p_bank_gl_line_ids uuid[] DEFAULT '{}'::uuid[])
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
   AND j.reference_type IN ('sale','sale_void','sale_refund');
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
REVOKE ALL ON FUNCTION public.bank_reconciliation_post_v4(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_post_v4(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[]) TO authenticated;
DROP FUNCTION public.bank_reconciliation_post_v3(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text,uuid[]);
CREATE OR REPLACE FUNCTION public.bank_reconciliation_finalize_v3(p_reconciliation_id uuid, p_transit jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
 actor uuid:=public._bank_actor('accounting.bank.validate');rec public.bank_reconciliations;prior public.bank_reconciliations;
 payload jsonb:=jsonb_build_object('reconciliation_id',p_reconciliation_id,'transit',p_transit);
 replay jsonb;result jsonb;v_snapshot jsonb;transit_rows jsonb;gl_rows jsonb;bank_rows jsonb;match_rows jsonb;
 transit_ids uuid[];scope_ids uuid[];unmatched_ids uuid[];gl_open numeric;gl_close numeric;
 bank_total numeric;transit_total numeric;carry_open numeric;gl_hash text;
BEGIN
 replay:=public._bank_replay(p_idempotency_key,'finalize',actor,payload);IF replay IS NOT NULL THEN RETURN replay;END IF;
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=p_reconciliation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-account:'||rec.account_id::text,0));
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=rec.id FOR UPDATE;
 IF rec.status<>'draft' THEN RAISE EXCEPTION 'reconciliation_finalized' USING ERRCODE='22023'; END IF;
 IF rec.opening_balance IS NULL OR rec.closing_balance IS NULL THEN
  RAISE EXCEPTION 'statement_balances_required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_transit) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transit)>5000 THEN
  RAISE EXCEPTION 'transit_array_required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_transit) t WHERE
  coalesce(length(trim(t->>'reason')),0) NOT BETWEEN 3 AND 1000 OR t->>'gl_line_id' IS NULL) THEN
  RAISE EXCEPTION 'transit_reason_required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg((t->>'gl_line_id')::uuid ORDER BY (t->>'gl_line_id')::uuid),'{}') INTO transit_ids
 FROM jsonb_array_elements(p_transit) t;
 IF cardinality(transit_ids)<>(SELECT count(DISTINCT x) FROM unnest(transit_ids) x) THEN
  RAISE EXCEPTION 'duplicate_transit_line' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.bank_reconciliations WHERE account_id=rec.account_id AND id<>rec.id
  AND ((period_end<rec.period_start AND status<>'finalized') OR (period_start>rec.period_end AND status='finalized'))) THEN
  RAISE EXCEPTION 'reconciliations_must_finalize_in_order' USING ERRCODE='22023'; END IF;
 -- Empêche un émetteur externe de modifier le GL pendant la capture finale.
 -- SHARE protège aussi les INSERTs absents lors du début de la transaction.
 -- _bank_actor tient déjà le profil FOR UPDATE : aucune FK audit/profil prise après SHARE.
 LOCK TABLE public.journal_entries,public.journal_entry_lines IN SHARE MODE;
 PERFORM 1 FROM public.accounts WHERE id=rec.account_id AND code IN ('1112','1113')
  AND is_active AND is_postable AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'eligible_bank_account_required' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM public.bank_reconciliations WHERE account_id=rec.account_id AND status='finalized'
  AND period_end<rec.period_start ORDER BY period_end DESC LIMIT 1;
 IF prior.id IS NOT NULL AND public._bank_source_integrity(prior.id)->>'state'<>'consistent' THEN
  RAISE EXCEPTION 'previous_reconciliation_source_changed' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.bank_statement_lines l WHERE l.reconciliation_id=rec.id
  AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_bank_claims c WHERE c.bank_line_id=l.id)) THEN
  RAISE EXCEPTION 'unmatched_bank_lines' USING ERRCODE='22023'; END IF;
 -- Relire les deux côtés : une liaison ne garantit pas l'immuabilité du journal source.
 IF EXISTS(SELECT 1 FROM public.bank_reconciliation_matches m WHERE m.reconciliation_id=rec.id AND m.removed_at IS NULL
  AND (m.amount IS DISTINCT FROM (SELECT sum(l.amount) FROM public.bank_statement_lines l WHERE l.id=ANY(m.bank_line_ids))
   OR m.amount IS DISTINCT FROM (SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l
    JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE l.id=ANY(m.gl_line_ids)
    AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=rec.period_end AND l.account_id=rec.account_id)
   OR cardinality(m.gl_line_ids)<>(SELECT count(*) FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
    WHERE l.id=ANY(m.gl_line_ids) AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND l.account_id=rec.account_id AND j.entry_date<=rec.period_end))) THEN
  RAISE EXCEPTION 'matched_source_changed' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(l.id ORDER BY l.id),'{}') INTO scope_ids
 FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
 WHERE l.account_id=rec.account_id AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=rec.period_end
  AND (j.entry_date>=rec.period_start OR EXISTS(SELECT 1 FROM public.bank_reconciliation_transit t
   JOIN public.bank_reconciliations r ON r.id=t.reconciliation_id WHERE t.gl_line_id=l.id
   AND r.account_id=rec.account_id AND r.status='finalized' AND r.period_end<rec.period_start));
 SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO unmatched_ids FROM unnest(scope_ids) x
 WHERE NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_gl_claims c WHERE c.gl_line_id=x);
 IF transit_ids<>unmatched_ids THEN RAISE EXCEPTION 'every_unmatched_gl_requires_transit_reason' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.bank_reconciliation_transit t JOIN public.bank_reconciliations r ON r.id=t.reconciliation_id
  JOIN LATERAL jsonb_array_elements(r.snapshot->'transit') s ON (s->>'gl_line_id')::uuid=t.gl_line_id
  LEFT JOIN public.journal_entry_lines l ON l.id=t.gl_line_id LEFT JOIN public.journal_entries j ON j.id=l.journal_entry_id
  WHERE r.account_id=rec.account_id AND r.status='finalized' AND r.period_end<rec.period_start
   AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_gl_claims c JOIN public.bank_reconciliation_matches m ON m.id=c.match_id
    JOIN public.bank_reconciliations mr ON mr.id=m.reconciliation_id WHERE c.gl_line_id=t.gl_line_id AND mr.period_end<rec.period_start)
   AND (l.id IS NULL OR NOT public._bank_gl_effective(j.status,j.reference_type,j.reference_id) OR l.account_id<>rec.account_id OR
    l.debit-l.credit IS DISTINCT FROM (s->>'amount')::numeric)) THEN
  RAISE EXCEPTION 'carried_transit_source_changed' USING ERRCODE='22023'; END IF;
 SELECT coalesce(sum(l.debit-l.credit) FILTER(WHERE j.entry_date<rec.period_start),0),coalesce(sum(l.debit-l.credit),0),
  encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_array(l.id,j.entry_date,l.debit,l.credit) ORDER BY l.id),'[]')::text,'sha256'),'hex')
 INTO gl_open,gl_close,gl_hash FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
 WHERE l.account_id=rec.account_id AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=rec.period_end;
 SELECT coalesce(sum(l.debit-l.credit),0) INTO carry_open FROM public.journal_entry_lines l
 JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE j.entry_date<rec.period_start AND l.id=ANY(scope_ids)
 AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_gl_claims c JOIN public.bank_reconciliation_matches m ON m.id=c.match_id
  JOIN public.bank_reconciliations r ON r.id=m.reconciliation_id WHERE c.gl_line_id=l.id AND r.period_end<rec.period_start);
 IF rec.opening_balance<>gl_open-carry_open THEN RAISE EXCEPTION 'opening_balance_unexplained' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM public.bank_reconciliations WHERE account_id=rec.account_id AND status='finalized'
  AND period_end<rec.period_start ORDER BY period_end DESC LIMIT 1;
 IF prior.id IS NOT NULL AND prior.period_end+1=rec.period_start AND prior.closing_balance<>rec.opening_balance THEN
  RAISE EXCEPTION 'previous_statement_balance_mismatch' USING ERRCODE='22023'; END IF;
 SELECT coalesce(sum(amount),0),coalesce(jsonb_agg(to_jsonb(l) ORDER BY ordinal),'[]') INTO bank_total,bank_rows
 FROM public.bank_statement_lines l WHERE reconciliation_id=rec.id;
 SELECT coalesce(sum(l.debit-l.credit),0),coalesce(jsonb_agg(jsonb_build_object('gl_line_id',l.id,
  'amount',l.debit-l.credit,'entry_date',j.entry_date,'reference_type',j.reference_type,'reference_id',j.reference_id,
  'reason',trim(t->>'reason')) ORDER BY l.id),'[]') INTO transit_total,transit_rows
 FROM jsonb_array_elements(p_transit) t JOIN public.journal_entry_lines l ON l.id=(t->>'gl_line_id')::uuid
 JOIN public.journal_entries j ON j.id=l.journal_entry_id;
 IF rec.opening_balance+bank_total<>rec.closing_balance OR gl_close-rec.closing_balance<>transit_total THEN
  RAISE EXCEPTION 'closing_balance_unexplained' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') INTO match_rows
 FROM public.bank_reconciliation_matches m WHERE reconciliation_id=rec.id;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO gl_rows FROM (
  SELECT l.*,j.entry_date,j.entry_number,j.reference_type,j.reference_id FROM public.journal_entry_lines l
  JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE l.id=ANY(scope_ids)) t;
 v_snapshot:=jsonb_build_object('captured_at',clock_timestamp(),'account_id',rec.account_id,'period_start',rec.period_start,
  'period_end',rec.period_end,'currency',rec.currency,'bank_opening',rec.opening_balance,'bank_closing',rec.closing_balance,
  'gl_opening',gl_open,'gl_closing',gl_close,'carry_open',carry_open,'gl_balance_sha256',gl_hash,
  'bank_lines',bank_rows,'gl_lines',gl_rows,'matches',match_rows,'transit',transit_rows,
  'imports',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM public.bank_statement_imports i WHERE reconciliation_id=rec.id));
 INSERT INTO public.bank_reconciliation_transit(reconciliation_id,gl_line_id,reason)
 SELECT rec.id,(t->>'gl_line_id')::uuid,trim(t->>'reason') FROM jsonb_array_elements(p_transit) t;
 UPDATE public.bank_reconciliations SET status='finalized',finalized_by=actor,finalized_at=now(),snapshot=v_snapshot,
  snapshot_sha256=encode(extensions.digest(v_snapshot::text,'sha256'),'hex') WHERE id=rec.id;
 result:=jsonb_build_object('ok',true,'reconciliation_id',rec.id,'status','finalized','transit_count',cardinality(transit_ids),
  'transit_total',transit_total,'snapshot_sha256',encode(extensions.digest(v_snapshot::text,'sha256'),'hex'));
 PERFORM public._bank_audit(actor,'accounting.bank.finalized',rec.id,result||jsonb_build_object('transit',transit_rows));
 RETURN public._bank_remember(p_idempotency_key,'finalize',actor,payload,result);
END $function$;
REVOKE ALL ON FUNCTION public.bank_reconciliation_finalize_v3(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_finalize_v3(uuid,jsonb,uuid) TO authenticated;
DROP FUNCTION public.bank_reconciliation_finalize_v2(uuid,jsonb,uuid);
