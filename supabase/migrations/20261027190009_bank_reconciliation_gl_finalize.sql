-- Corps de départ relu sur rehearsal via pg_get_functiondef.
CREATE OR REPLACE FUNCTION public.bank_reconciliation_finalize_v2(p_reconciliation_id uuid, p_transit jsonb, p_idempotency_key uuid)
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
REVOKE ALL ON FUNCTION public.bank_reconciliation_finalize_v2(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_finalize_v2(uuid,jsonb,uuid) TO authenticated;
DROP FUNCTION public.bank_reconciliation_finalize_v1(uuid,jsonb,uuid);
