-- Corps live dev : même ordre chronologique que l'import, même contrat de soldes.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.bank_reconciliation_balances_v2(p_reconciliation_id uuid, p_opening_balance numeric, p_closing_balance numeric, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor uuid:=public._bank_actor('accounting.bank.manage');rec public.bank_reconciliations;
 payload jsonb:=jsonb_build_object('reconciliation_id',p_reconciliation_id,'opening_balance',p_opening_balance,'closing_balance',p_closing_balance);
 replay jsonb;result jsonb;opening numeric;closing numeric;total numeric;
BEGIN
 replay:=public._bank_replay(p_idempotency_key,'balances',actor,payload);IF replay IS NOT NULL THEN RETURN replay;END IF;
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=p_reconciliation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-account:'||rec.account_id::text,0));
 SELECT * INTO rec FROM public.bank_reconciliations WHERE id=rec.id FOR UPDATE;
 IF rec.status<>'draft' THEN RAISE EXCEPTION 'reconciliation_finalized' USING ERRCODE='22023'; END IF;
 opening:=public._bank_money(to_jsonb(p_opening_balance),true);closing:=public._bank_money(to_jsonb(p_closing_balance),true);
 SELECT coalesce(sum(amount),0) INTO total FROM public.bank_statement_lines WHERE reconciliation_id=rec.id;
 IF opening IS NOT NULL AND closing IS NOT NULL AND opening+total<>closing THEN
  RAISE EXCEPTION 'statement_balance_mismatch' USING ERRCODE='22023'; END IF;
 IF opening IS NOT NULL AND EXISTS(SELECT 1 FROM (
  SELECT balance,opening+sum(amount) OVER(ORDER BY transaction_date,source_row,ordinal ROWS UNBOUNDED PRECEDING) expected FROM public.bank_statement_lines WHERE reconciliation_id=rec.id
 ) t WHERE balance IS NOT NULL AND balance<>expected) THEN
  RAISE EXCEPTION 'running_balance_mismatch' USING ERRCODE='22023'; END IF;
 UPDATE public.bank_reconciliations SET opening_balance=opening,closing_balance=closing WHERE id=rec.id;
 result:=jsonb_build_object('ok',true,'reconciliation_id',rec.id,'opening_balance',opening,'closing_balance',closing);
 PERFORM public._bank_audit(actor,'accounting.bank.balances_updated',rec.id,
  jsonb_build_object('before',jsonb_build_object('opening_balance',rec.opening_balance,'closing_balance',rec.closing_balance),'after',result));
 RETURN public._bank_remember(p_idempotency_key,'balances',actor,payload,result);
END $function$;
REVOKE ALL ON FUNCTION public.bank_reconciliation_balances_v2(uuid,numeric,numeric,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_balances_v2(uuid,numeric,numeric,uuid) TO authenticated;
DROP FUNCTION public.bank_reconciliation_balances_v1(uuid,numeric,numeric,uuid);
