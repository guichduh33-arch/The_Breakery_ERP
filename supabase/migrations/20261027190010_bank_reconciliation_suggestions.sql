-- Suggestions exactes : unicité calculée sur le périmètre entier avant pagination.
CREATE FUNCTION public.bank_reconciliation_suggestions_v1(
 p_reconciliation_id uuid,p_after bigint DEFAULT 0,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public._bank_actor('accounting.bank.read');rec public.bank_reconciliations;items jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_after IS NULL OR p_after<0 THEN
  RAISE EXCEPTION 'invalid_page_size' USING ERRCODE='22023'; END IF;
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=p_reconciliation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE='P0002'; END IF;
 WITH bank_candidates AS (
  SELECT l.*,count(*) OVER(PARTITION BY l.transaction_date,l.amount) candidate_count
  FROM public.bank_statement_lines l WHERE l.reconciliation_id=rec.id
   AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_bank_claims c WHERE c.bank_line_id=l.id)
 ),gl_candidates AS (
  SELECT l.*,j.entry_date,j.entry_number,j.reference_type,j.reference_id,
   count(*) OVER(PARTITION BY j.entry_date,l.debit-l.credit) candidate_count
  FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
  WHERE l.account_id=rec.account_id AND j.entry_date<=rec.period_end
   AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id)
   AND (j.entry_date>=rec.period_start OR EXISTS(SELECT 1 FROM public.bank_reconciliation_transit t
    JOIN public.bank_reconciliations prior ON prior.id=t.reconciliation_id WHERE t.gl_line_id=l.id
    AND prior.account_id=rec.account_id AND prior.status='finalized' AND prior.period_end<rec.period_start))
   AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_gl_claims c WHERE c.gl_line_id=l.id)
 ),paged AS (
  SELECT b.id bank_line_id,b.ordinal bank_ordinal,b.transaction_date bank_date,b.amount bank_amount,
   b.description bank_description,g.id gl_line_id,g.entry_date gl_date,g.debit-g.credit gl_amount,
   g.description gl_description,g.journal_entry_id je_id,g.entry_number,g.reference_type,g.reference_id
  FROM bank_candidates b JOIN gl_candidates g ON g.entry_date=b.transaction_date AND g.debit-g.credit=b.amount
  WHERE b.candidate_count=1 AND g.candidate_count=1 AND b.ordinal>p_after
  ORDER BY b.ordinal LIMIT p_limit
 ) SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.bank_ordinal),'[]') INTO items FROM paged p;
 PERFORM public._bank_audit(actor,'accounting.bank.suggestions_read',rec.id);
 RETURN jsonb_build_object('items',items,'next_after',CASE WHEN jsonb_array_length(items)=p_limit THEN items->-1->'bank_ordinal' END);
END $$;
REVOKE ALL ON FUNCTION public.bank_reconciliation_suggestions_v1(uuid,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_suggestions_v1(uuid,bigint,integer) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
