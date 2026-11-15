-- Les encaissements de l'import historique (Olsera) n'ont jamais eu de clé de
-- tentative POS : la v1 les masquait aux non-propriétaires, ce qui faussait
-- le solde 1110 vu par ADMIN. La v2 les reconnaît par leur lien d'import
-- (commande -> document -> run appliqué, et run cité par l'écriture), jamais
-- par leur libellé. Les écritures d'un shift ouvert restent masquées.
-- Corps repris du pg_get_functiondef live de la v1 (dev et prod identiques au
-- 2026-11-15, aux fins de ligne près) ; seul l'embranchement NOT FOUND change.
CREATE FUNCTION public.can_view_financial_entry_v2(p_entry_id uuid, p_detail boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_entry public.journal_entries%ROWTYPE; v_session uuid; v_order public.orders%ROWTYPE;
 v_attempt public.pos_payment_attempt_keys%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 IF public.is_business_owner_v1() THEN RETURN true; END IF;
 SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_entry_id;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Les écarts/opnames et les lignes de valorisation ne sont pas des détails ADMIN.
 IF p_detail AND (v_entry.reference_type IN('stock_movement','inventory_count','opname')
  OR EXISTS(SELECT 1 FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
   WHERE l.journal_entry_id=p_entry_id AND a.code LIKE '114%')) THEN RETURN false; END IF;
 IF v_entry.reference_type IN('sale','sale_void') THEN
  SELECT * INTO v_order FROM public.orders WHERE id=v_entry.reference_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_order.order_type='b2b' THEN RETURN true; END IF;
  -- La reconnaissance initiale suit son shift, les encaissements ultérieurs leur JE dédiée.
  v_session:=v_order.session_id;
  IF v_entry.reference_type='sale_void' THEN
   SELECT coalesce(r.payment_session_id,r.session_id) INTO v_session
   FROM public.refunds r WHERE r.order_id=v_order.id AND r.is_full_void
   ORDER BY r.created_at DESC LIMIT 1;
   v_session:=coalesce(v_session,v_order.session_id);
  END IF;
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type IN('sale_refund','refund') THEN
  SELECT coalesce(payment_session_id,session_id) INTO v_session
  FROM public.refunds WHERE id=v_entry.reference_id;
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type='pos_outstanding_payment' THEN
  SELECT * INTO v_attempt FROM public.pos_payment_attempt_keys WHERE key=v_entry.reference_id;
  IF NOT FOUND THEN
   -- Encaissement importé : paiement hors shift d'une commande née d'un
   -- document historique, dans le run appliqué que l'écriture elle-même cite.
   RETURN EXISTS(SELECT 1 FROM public.order_payments p
    JOIN public.orders o ON o.id=p.order_id
    JOIN public.historical_import_documents d ON d.id=o.financial_import_document_id AND d.entity_id=o.id
    JOIN public.historical_import_runs r ON r.id=d.run_id
    WHERE p.id=v_entry.reference_id AND p.session_id IS NULL AND r.status='applied'
     AND r.id::text=v_entry.metadata->>'financial_import_run_id');
  END IF;
  IF v_attempt.request->>'operation'='settle' AND v_attempt.request->>'session' IS NULL THEN
   RETURN true;
  END IF;
  v_session:=coalesce(nullif(v_attempt.request->>'session','')::uuid,
   nullif(v_attempt.request->>'session_id','')::uuid,
   (SELECT session_id FROM public.orders WHERE id=v_attempt.order_id));
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type IN('outstanding_payment','pos_receipt','sale_receipt','sale_payment') THEN
  v_session:=nullif(v_entry.metadata->>'session_id','')::uuid;
  IF v_session IS NULL THEN
   SELECT p.session_id INTO v_session FROM public.order_payments p
   WHERE p.id=v_entry.reference_id;
  END IF;
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type='cash_movement' THEN
  IF v_entry.metadata->>'session_id' IS NOT NULL THEN
   RETURN public.can_view_financial_shift_v1((v_entry.metadata->>'session_id')::uuid);
  END IF;
  SELECT session_id INTO v_session FROM public.cash_movements WHERE id=v_entry.reference_id;
  -- Les mouvements de coffres hors POS ont une idempotence dédiée.
  IF NOT FOUND THEN RETURN EXISTS(SELECT 1 FROM public.cash_movement_idempotency_keys k
   WHERE k.je_id=p_entry_id); END IF;
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type IN('shift_close','shift_variance','pos_session') THEN
  RETURN public.can_view_financial_shift_v1(v_entry.reference_id);
 END IF;
 RETURN true;
END $function$;

REVOKE ALL ON FUNCTION public.can_view_financial_entry_v2(uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_financial_entry_v2(uuid,boolean) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Mêmes droits que la v1 : les policies RLS l'évaluent sous authenticated.
GRANT EXECUTE ON FUNCTION public.can_view_financial_entry_v2(uuid,boolean) TO authenticated, service_role;

-- Les quatre dépendants live de la v1 (deux vues, deux policies) passent sur la v2.
CREATE OR REPLACE VIEW reporting_private.closed_shift_journal_entries_v1 AS
 SELECT id,entry_number,entry_date,description,reference_type,reference_id,status,
  total_debit,total_credit,created_by,created_at,updated_at,metadata
 FROM public.journal_entries j WHERE public.can_view_financial_entry_v2(id,false);
CREATE OR REPLACE VIEW reporting_private.safe_detail_journal_entries_v1 AS
 SELECT id,entry_number,entry_date,description,reference_type,reference_id,status,
  total_debit,total_credit,created_by,created_at,updated_at,metadata
 FROM public.journal_entries j WHERE public.can_view_financial_entry_v2(id,true);
ALTER POLICY confidentiality_financial_entries ON public.journal_entries
 USING (public.can_view_financial_entry_v2(id,true));
ALTER POLICY confidentiality_financial_lines ON public.journal_entry_lines
 USING (public.can_view_financial_entry_v2(journal_entry_id,true));

DROP FUNCTION public.can_view_financial_entry_v1(uuid,boolean);
