-- Wrapper du créateur de journal live : PIN jamais conservé, réservations définitives.
CREATE FUNCTION public.bank_reconciliation_post_v1(
 p_reconciliation_id uuid,p_bank_line_ids uuid[],p_clearing_line_ids uuid[],p_counter_account_id uuid,
 p_fee_amount numeric,p_entry_date date,p_description text,p_manager_pin text,p_idempotency_key uuid,
 p_kind text DEFAULT 'settlement'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 actor uuid:=public._bank_actor('accounting.bank.settle');rec public.bank_reconciliations;
 payload jsonb:=jsonb_build_object('reconciliation_id',p_reconciliation_id,'bank_line_ids',p_bank_line_ids,
  'clearing_line_ids',p_clearing_line_ids,'counter_account_id',p_counter_account_id,'fee_amount',p_fee_amount,
  'entry_date',p_entry_date,'description',p_description,'kind',p_kind);
 replay jsonb;result jsonb;je_result jsonb;lines jsonb:='[]';bank_sum numeric;clearing_sum numeric;fee numeric;
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
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-account:'||rec.account_id::text,0));
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=rec.id FOR UPDATE;
 IF rec.status<>'draft' THEN RAISE EXCEPTION 'reconciliation_finalized' USING ERRCODE='22023'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('settlement','fee','interest') OR p_entry_date IS NULL OR
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
 IF p_kind='settlement' THEN
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
   AND a.deleted_at IS NULL AND j.status='posted' AND j.entry_date<=p_entry_date
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
  'debit',greatest(bank_sum,0),'credit',greatest(-bank_sum,0),'description',p_description));
 -- Le refus JSON laisse commiter le compteur de PIN. Aucun claim ni JE avant cet appel.
 PERFORM 1 FROM public.fiscal_periods WHERE p_entry_date BETWEEN period_start AND period_end FOR SHARE;
 je_result:=public.create_manual_je_v2(p_description,p_entry_date,lines,p_manager_pin);
 IF je_result->>'ok'='false' THEN RETURN je_result; END IF;
 je_id:=(je_result->>'je_id')::uuid;
 SELECT l.id INTO STRICT bank_gl_id FROM public.journal_entry_lines l
  WHERE l.journal_entry_id=je_id AND l.account_id=rec.account_id;
 INSERT INTO public.bank_reconciliation_entries(id,reconciliation_id,kind,bank_line_ids,clearing_line_ids,
  journal_entry_id,bank_gl_line_id,fee_amount,created_by)
 VALUES(entry_id,rec.id,p_kind,p_bank_line_ids,p_clearing_line_ids,je_id,bank_gl_id,fee,actor);
 INSERT INTO public.bank_reconciliation_clearing_claims SELECT x,entry_id FROM unnest(p_clearing_line_ids) x;
 INSERT INTO public.bank_reconciliation_entry_bank_claims SELECT x,entry_id FROM unnest(p_bank_line_ids) x;
 -- Même transaction : émission du journal, claims clearing et liaison bancaire.
 match_result:=public.bank_reconciliation_match_v1(rec.id,p_bank_line_ids,ARRAY[bank_gl_id],entry_id);
 result:=jsonb_build_object('ok',true,'entry_id',entry_id,'je_id',je_id,'bank_gl_line_id',bank_gl_id,
  'match_id',match_result->'match_id','amount',bank_sum,'actual_fee',fee);
 PERFORM public._bank_audit(actor,'accounting.bank.posted',rec.id,payload||result);
 RETURN public._bank_remember(p_idempotency_key,'post',actor,payload,result);
END $$;
REVOKE ALL ON FUNCTION public.bank_reconciliation_post_v1(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_post_v1(uuid,uuid[],uuid[],uuid,numeric,date,text,text,uuid,text) TO authenticated;
