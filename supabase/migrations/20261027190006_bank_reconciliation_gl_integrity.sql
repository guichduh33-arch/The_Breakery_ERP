-- Périmètre identique au GL live : posted/locked, garde des anciens doubles voids.
CREATE FUNCTION public._bank_gl_effective(p_status text,p_reference_type text,p_reference_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_status IN ('posted','locked') AND NOT (p_reference_type IS NOT DISTINCT FROM 'sale_void'
  AND EXISTS(SELECT 1 FROM public.journal_entries jr JOIN public.refunds rf ON rf.id=jr.reference_id
   WHERE jr.reference_type='sale_refund' AND rf.order_id=p_reference_id));
$$;
CREATE FUNCTION public._bank_source_integrity(p_reconciliation_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE rec public.bank_reconciliations;live_hash text;live_close numeric;
BEGIN
 SELECT * INTO STRICT rec FROM public.bank_reconciliations WHERE id=p_reconciliation_id;
 IF rec.snapshot IS NULL THEN RETURN jsonb_build_object('state','draft'); END IF;
 SELECT coalesce(sum(l.debit-l.credit),0),encode(extensions.digest(coalesce(
  jsonb_agg(jsonb_build_array(l.id,j.entry_date,l.debit,l.credit) ORDER BY l.id),'[]')::text,'sha256'),'hex')
 INTO live_close,live_hash FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
 WHERE l.account_id=rec.account_id AND j.entry_date<=rec.period_end
  AND public._bank_gl_effective(j.status,j.reference_type,j.reference_id);
 RETURN jsonb_build_object('reconciliation_id',rec.id,'state',
  CASE WHEN live_hash=rec.snapshot->>'gl_balance_sha256' THEN 'consistent' ELSE 'changed' END,
  'recorded_gl_closing',rec.snapshot->'gl_closing','current_gl_closing',live_close,
  'recorded_sha256',rec.snapshot->>'gl_balance_sha256','current_sha256',live_hash);
END $$;
REVOKE ALL ON FUNCTION public._bank_gl_effective(text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._bank_source_integrity(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
