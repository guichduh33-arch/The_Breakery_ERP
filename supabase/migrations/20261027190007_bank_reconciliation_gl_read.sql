-- Corps de départ relu sur rehearsal via pg_get_functiondef.
CREATE OR REPLACE FUNCTION public.bank_reconciliation_clearing_v2(p_reconciliation_id uuid, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
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
   AND j.reference_type IN ('sale','sale_refund','sale_void')
   AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_clearing_claims c WHERE c.gl_line_id=l.id)
  ORDER BY l.id LIMIT p_limit) t;
 PERFORM public._bank_audit(actor,'accounting.bank.clearing_read',rec.id);
 RETURN jsonb_build_object('items',r,'next_after',CASE WHEN jsonb_array_length(r)=p_limit THEN r->-1->>'id' END);
END $function$;
REVOKE ALL ON FUNCTION public.bank_reconciliation_clearing_v2(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_clearing_v2(uuid,uuid,integer) TO authenticated;
DROP FUNCTION public.bank_reconciliation_clearing_v1(uuid,uuid,integer);
-- Corps de départ relu sur rehearsal via pg_get_functiondef.
CREATE OR REPLACE FUNCTION public.bank_reconciliation_detail_v2(p_reconciliation_id uuid, p_bank_after bigint DEFAULT 0, p_gl_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor uuid:=public._bank_actor('accounting.bank.read');rec public.bank_reconciliations;
 bank_rows jsonb;gl_rows jsonb;matches jsonb;imports jsonb;entries jsonb;gl_open numeric;gl_close numeric;integrity jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_bank_after IS NULL OR p_bank_after<0 THEN
  RAISE EXCEPTION 'invalid_page_size' USING ERRCODE='22023'; END IF;
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=p_reconciliation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE='P0002'; END IF;
 integrity:=CASE WHEN rec.status='finalized' THEN public._bank_source_integrity(rec.id) ELSE
  (SELECT public._bank_source_integrity(r.id) FROM public.bank_reconciliations r WHERE r.account_id=rec.account_id
   AND r.status='finalized' AND r.period_end<rec.period_start ORDER BY r.period_end DESC LIMIT 1) END;
 IF rec.status='finalized' THEN
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'ordinal')::bigint),'[]') INTO bank_rows FROM (
   SELECT x FROM jsonb_array_elements(rec.snapshot->'bank_lines') x WHERE (x->>'ordinal')::bigint>p_bank_after
   ORDER BY (x->>'ordinal')::bigint LIMIT p_limit) t;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'id')::uuid),'[]') INTO gl_rows FROM (
   SELECT x FROM jsonb_array_elements(rec.snapshot->'gl_lines') x WHERE p_gl_after IS NULL OR (x->>'id')::uuid>p_gl_after
   ORDER BY (x->>'id')::uuid LIMIT p_limit) t;
  PERFORM public._bank_audit(actor,'accounting.bank.detail_read',rec.id,jsonb_build_object('frozen',true));
  RETURN jsonb_build_object('reconciliation',to_jsonb(rec),'source_integrity',integrity,'bank_lines',bank_rows,'gl_lines',gl_rows,
   'matches',rec.snapshot->'matches','imports',rec.snapshot->'imports','entries',
   (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at),'[]') FROM public.bank_reconciliation_entries e WHERE reconciliation_id=rec.id),
   'balances',jsonb_build_object('bank_opening',rec.opening_balance,'bank_closing',rec.closing_balance,
    'gl_opening',rec.snapshot->'gl_opening','gl_closing',rec.snapshot->'gl_closing',
    'bank_total',rec.closing_balance-rec.opening_balance),
   'next_bank_after',CASE WHEN jsonb_array_length(bank_rows)=p_limit THEN bank_rows->-1->'ordinal' END,
   'next_gl_after',CASE WHEN jsonb_array_length(gl_rows)=p_limit THEN gl_rows->-1->>'id' END,
   'match_history_truncated',false);
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.ordinal),'[]') INTO bank_rows FROM (
  SELECT l.*,c.match_id FROM public.bank_statement_lines l
  LEFT JOIN public.bank_reconciliation_bank_claims c ON c.bank_line_id=l.id
  WHERE l.reconciliation_id=rec.id AND l.ordinal>p_bank_after ORDER BY l.ordinal LIMIT p_limit) t;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO gl_rows FROM (
  SELECT l.id,l.account_id,l.journal_entry_id,l.debit,l.credit,l.debit-l.credit amount,l.description,
   j.entry_number,j.entry_date,j.reference_type,j.reference_id,c.match_id,
   tr.reason transit_reason
  FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
  LEFT JOIN public.bank_reconciliation_gl_claims c ON c.gl_line_id=l.id
  LEFT JOIN public.bank_reconciliation_matches m ON m.id=c.match_id
  LEFT JOIN public.bank_reconciliation_transit tr ON tr.gl_line_id=l.id AND tr.reconciliation_id=rec.id
  WHERE l.account_id=rec.account_id AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=rec.period_end
   AND (j.entry_date>=rec.period_start OR EXISTS(SELECT 1 FROM public.bank_reconciliation_transit t
    JOIN public.bank_reconciliations prior ON prior.id=t.reconciliation_id
    WHERE t.gl_line_id=l.id AND prior.account_id=rec.account_id AND prior.status='finalized' AND prior.period_end<rec.period_start))
   AND (c.gl_line_id IS NULL OR m.reconciliation_id=rec.id)
   AND (p_gl_after IS NULL OR l.id>p_gl_after) ORDER BY l.id LIMIT p_limit) t;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id),'[]') INTO matches FROM (
  SELECT * FROM public.bank_reconciliation_matches WHERE reconciliation_id=rec.id
  ORDER BY created_at DESC,id LIMIT 100) t;
 SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.created_at),'[]') INTO imports
 FROM public.bank_statement_imports i WHERE i.reconciliation_id=rec.id;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at),'[]') INTO entries
 FROM public.bank_reconciliation_entries e WHERE e.reconciliation_id=rec.id;
 SELECT coalesce(sum(l.debit-l.credit) FILTER(WHERE j.entry_date<rec.period_start),0),
  coalesce(sum(l.debit-l.credit),0) INTO gl_open,gl_close
 FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
 WHERE l.account_id=rec.account_id AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=rec.period_end;
 PERFORM public._bank_audit(actor,'accounting.bank.detail_read',rec.id);
 RETURN jsonb_build_object('reconciliation',to_jsonb(rec),'source_integrity',integrity,'bank_lines',bank_rows,'gl_lines',gl_rows,
  'matches',matches,'imports',imports,'entries',entries,'balances',jsonb_build_object(
   'bank_opening',rec.opening_balance,'bank_closing',rec.closing_balance,
   'gl_opening',gl_open,'gl_closing',gl_close,'bank_total',
   (SELECT coalesce(sum(amount),0) FROM public.bank_statement_lines WHERE reconciliation_id=rec.id)),
  'next_bank_after',CASE WHEN jsonb_array_length(bank_rows)=p_limit THEN bank_rows->-1->'ordinal' END,
  'next_gl_after',CASE WHEN jsonb_array_length(gl_rows)=p_limit THEN gl_rows->-1->>'id' END,
  'match_history_truncated',(SELECT count(*)>100 FROM public.bank_reconciliation_matches WHERE reconciliation_id=rec.id));
END $function$;
REVOKE ALL ON FUNCTION public.bank_reconciliation_detail_v2(uuid,bigint,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_detail_v2(uuid,bigint,uuid,integer) TO authenticated;
DROP FUNCTION public.bank_reconciliation_detail_v1(uuid,bigint,uuid,integer);
-- Corps de départ relu sur rehearsal via pg_get_functiondef.
CREATE OR REPLACE FUNCTION public.bank_reconciliation_match_v2(p_reconciliation_id uuid, p_bank_line_ids uuid[], p_gl_line_ids uuid[], p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor uuid:=public._bank_actor('accounting.bank.manage');rec public.bank_reconciliations;
 payload jsonb:=jsonb_build_object('reconciliation_id',p_reconciliation_id,'bank_line_ids',p_bank_line_ids,'gl_line_ids',p_gl_line_ids);
 replay jsonb;result jsonb;bank_sum numeric;gl_sum numeric;cnt integer;match_id uuid:=gen_random_uuid();
BEGIN
 replay:=public._bank_replay(p_idempotency_key,'match',actor,payload);
 IF replay IS NOT NULL THEN RETURN replay; END IF;
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=p_reconciliation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-account:'||rec.account_id::text,0));
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=rec.id FOR UPDATE;
 IF rec.status<>'draft' THEN RAISE EXCEPTION 'reconciliation_finalized' USING ERRCODE='22023'; END IF;
 IF coalesce(cardinality(p_bank_line_ids),0) NOT BETWEEN 1 AND 1000 OR
  coalesce(cardinality(p_gl_line_ids),0) NOT BETWEEN 1 AND 1000 OR
  cardinality(p_bank_line_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_bank_line_ids) x) OR
  cardinality(p_gl_line_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_gl_line_ids) x) THEN
  RAISE EXCEPTION 'unique_match_lines_required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.bank_statement_lines l WHERE l.id=ANY(p_bank_line_ids) ORDER BY l.id FOR UPDATE;
 PERFORM 1 FROM public.journal_entries j WHERE j.id IN
  (SELECT journal_entry_id FROM public.journal_entry_lines WHERE id=ANY(p_gl_line_ids)) ORDER BY j.id FOR UPDATE;
 PERFORM 1 FROM public.journal_entry_lines l WHERE l.id=ANY(p_gl_line_ids) ORDER BY l.id FOR UPDATE;
 SELECT count(*),sum(l.amount) INTO cnt,bank_sum FROM public.bank_statement_lines l
 WHERE l.id=ANY(p_bank_line_ids) AND l.reconciliation_id=rec.id;
 IF cnt<>cardinality(p_bank_line_ids) OR EXISTS(SELECT 1 FROM public.bank_reconciliation_bank_claims WHERE bank_line_id=ANY(p_bank_line_ids)) THEN
  RAISE EXCEPTION 'bank_line_unavailable' USING ERRCODE='22023'; END IF;
 SELECT count(*),sum(l.debit-l.credit) INTO cnt,gl_sum FROM public.journal_entry_lines l
 JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE l.id=ANY(p_gl_line_ids)
 AND l.account_id=rec.account_id AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id) AND j.entry_date<=rec.period_end
 AND (j.entry_date>=rec.period_start OR EXISTS(SELECT 1 FROM public.bank_reconciliation_transit t
  JOIN public.bank_reconciliations prior ON prior.id=t.reconciliation_id WHERE t.gl_line_id=l.id
  AND prior.account_id=rec.account_id AND prior.status='finalized' AND prior.period_end<rec.period_start));
 IF cnt<>cardinality(p_gl_line_ids) OR EXISTS(SELECT 1 FROM public.bank_reconciliation_gl_claims WHERE gl_line_id=ANY(p_gl_line_ids)) THEN
  RAISE EXCEPTION 'gl_line_unavailable' USING ERRCODE='22023'; END IF;
 IF bank_sum<>gl_sum THEN RAISE EXCEPTION 'match_amount_mismatch' USING ERRCODE='22023'; END IF;
 INSERT INTO public.bank_reconciliation_matches(id,reconciliation_id,bank_line_ids,gl_line_ids,amount,created_by)
 VALUES(match_id,rec.id,p_bank_line_ids,p_gl_line_ids,bank_sum,actor);
 INSERT INTO public.bank_reconciliation_bank_claims SELECT x,match_id FROM unnest(p_bank_line_ids) x;
 INSERT INTO public.bank_reconciliation_gl_claims SELECT x,match_id FROM unnest(p_gl_line_ids) x;
 result:=jsonb_build_object('ok',true,'match_id',match_id,'amount',bank_sum);
 PERFORM public._bank_audit(actor,'accounting.bank.matched',rec.id,payload||result);
 RETURN public._bank_remember(p_idempotency_key,'match',actor,payload,result);
END $function$;
REVOKE ALL ON FUNCTION public.bank_reconciliation_match_v2(uuid,uuid[],uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_match_v2(uuid,uuid[],uuid[],uuid) TO authenticated;
DROP FUNCTION public.bank_reconciliation_match_v1(uuid,uuid[],uuid[],uuid);
