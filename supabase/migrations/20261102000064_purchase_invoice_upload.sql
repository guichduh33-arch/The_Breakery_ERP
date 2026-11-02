CREATE TABLE public.po_invoice_results(
 idempotency_key uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
 request_payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX po_invoice_results_po ON public.po_invoice_results(po_id);
CREATE INDEX po_invoice_results_actor ON public.po_invoice_results(actor_id);
ALTER TABLE public.po_invoice_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY pin_session_required ON public.po_invoice_results AS RESTRICTIVE FOR ALL TO authenticated
 USING(public.request_has_active_pin_session_v1()) WITH CHECK(public.request_has_active_pin_session_v1());
REVOKE ALL ON public.po_invoice_results FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.po_invoice_results TO service_role;

CREATE FUNCTION public.storage_path_to_po_id_v1(p_path text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
BEGIN
 IF split_part(p_path,'/',1)<>'purchase-orders' THEN RETURN NULL; END IF;
 RETURN split_part(p_path,'/',2)::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.storage_path_to_po_id_v1(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_path_to_po_id_v1(text) TO authenticated,service_role;

CREATE FUNCTION public.can_upload_po_invoice_v1(p_po_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND public.request_has_active_pin_session_v1() AND
  (public.has_permission(auth.uid(),'purchasing.po.create') OR public.has_permission(auth.uid(),'purchasing.po.pay'))
  AND EXISTS(SELECT 1 FROM public.purchase_orders p WHERE p.id=p_po_id AND p.deleted_at IS NULL
   AND p.status<>'cancelled' AND COALESCE((SELECT sum(x.amount) FROM public.purchase_payments x
    WHERE x.purchase_order_id=p.id),0)<p.total_amount AND (p.invoice_path IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.purchase_payments x WHERE x.purchase_order_id=p.id)))
$$;
REVOKE ALL ON FUNCTION public.can_upload_po_invoice_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_upload_po_invoice_v1(uuid) TO authenticated,service_role;
CREATE POLICY purchase_invoices_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
 bucket_id='purchase-invoices'
 AND name ~ '^purchase-orders/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|pdf)$'
 AND public.can_upload_po_invoice_v1(public.storage_path_to_po_id_v1(name))
);
-- Pas de lecture publique, de suppression ni d'overwrite : le téléchargement passe par l'EF.
CREATE POLICY purchase_invoices_proxy_only ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(bucket_id<>'purchase-invoices');

CREATE FUNCTION public.set_po_invoice_v1(p_po_id uuid,p_storage_path text DEFAULT NULL,
 p_expected_path text DEFAULT NULL,p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 p public.purchase_orders%ROWTYPE; a uuid; v_path text:=NULLIF(p_storage_path,'');
 v_request jsonb:=jsonb_build_object('storage_path',NULLIF(p_storage_path,''),'expected_path',NULLIF(p_expected_path,''));
 old_result public.po_invoice_results%ROWTYPE; v_result jsonb; v_owner text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.request_has_active_pin_session_v1() THEN
  RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
 a:=public._current_profile_id();
 IF a IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='28000'; END IF;
 IF NOT (public.has_permission(auth.uid(),'purchasing.po.create') OR public.has_permission(auth.uid(),'purchasing.po.pay')) THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'invoice_key_required' USING ERRCODE='22023'; END IF;
 -- Même clé sérialisée, y compris si deux commandes différentes la présentent simultanément.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,631));
 SELECT * INTO p FROM public.purchase_orders WHERE id=p_po_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO old_result FROM public.po_invoice_results WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF old_result.actor_id IS DISTINCT FROM a OR old_result.po_id IS DISTINCT FROM p.id
   OR old_result.request_payload IS DISTINCT FROM v_request THEN
   RAISE EXCEPTION 'po_invoice_key_conflict' USING ERRCODE='22023'; END IF;
  RETURN old_result.result||jsonb_build_object('idempotent_replay',true);
 END IF;
 IF p.invoice_path IS NOT DISTINCT FROM v_path THEN
  v_result:=jsonb_build_object('po_id',p.id,'invoice_path',v_path,'applied',true,'idempotent_replay',true);
 ELSIF NOT public.can_upload_po_invoice_v1(p.id)
   OR (v_path IS NULL AND EXISTS(SELECT 1 FROM public.purchase_payments WHERE purchase_order_id=p.id))
   OR p.invoice_path IS DISTINCT FROM NULLIF(p_expected_path,'') THEN
  v_result:=jsonb_build_object('po_id',p.id,'invoice_path',p.invoice_path,'applied',false,'idempotent_replay',false,
   'reason',CASE WHEN NOT public.can_upload_po_invoice_v1(p.id)
    OR (v_path IS NULL AND EXISTS(SELECT 1 FROM public.purchase_payments WHERE purchase_order_id=p.id))
    THEN 'invoice_requires_unpaid_order' ELSE 'invoice_changed' END);
 ELSE
  IF v_path IS NOT NULL THEN
   IF v_path !~ '^purchase-orders/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|pdf)$'
    OR public.storage_path_to_po_id_v1(v_path) IS DISTINCT FROM p.id THEN
    RAISE EXCEPTION 'invalid_invoice_path' USING ERRCODE='22023'; END IF;
   IF split_part(split_part(v_path,'/',3),'.',1)::uuid IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'invoice_path_key_mismatch' USING ERRCODE='22023'; END IF;
   SELECT COALESCE(NULLIF(owner_id,''),owner::text) INTO v_owner FROM storage.objects
    WHERE bucket_id='purchase-invoices' AND name=v_path AND archived_at IS NULL AND NOT COALESCE(is_delete_marker,false);
   IF NOT FOUND THEN RAISE EXCEPTION 'invoice_object_not_found' USING ERRCODE='P0002'; END IF;
   IF v_owner IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'invoice_object_owner_mismatch' USING ERRCODE='42501'; END IF;
   IF NOT public._payment_invoice_valid_v1('purchase-invoices',v_path,'purchase-orders/'||p.id||'/') THEN
    RAISE EXCEPTION 'invalid_invoice_file' USING ERRCODE='22023'; END IF;
  END IF;
  UPDATE public.purchase_orders SET invoice_path=v_path WHERE id=p.id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
   VALUES(a,'po.invoice_updated','purchase_order',p.id,jsonb_build_object('po_number',p.po_number),
    jsonb_build_object('invoice_path',jsonb_build_object('from',p.invoice_path,'to',v_path)));
  v_result:=jsonb_build_object('po_id',p.id,'invoice_path',v_path,'applied',true,'idempotent_replay',false);
 END IF;
 INSERT INTO public.po_invoice_results(idempotency_key,actor_id,po_id,request_payload,result)
  VALUES(p_idempotency_key,a,p.id,v_request,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.set_po_invoice_v1(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_po_invoice_v1(uuid,text,text,uuid) TO authenticated,service_role;

CREATE FUNCTION public.authorize_po_invoice_download_v1(p_session_id uuid,p_po_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_profile_id uuid; v_auth_id uuid; v_path text;
BEGIN
 SELECT p.id,p.auth_user_id INTO v_profile_id,v_auth_id FROM public.user_sessions s
  JOIN public.user_profiles p ON p.id=s.user_id WHERE s.id=p_session_id;
 IF v_auth_id IS NULL OR NOT public.is_pin_session_active_v1(p_session_id,v_auth_id) THEN
  RAISE EXCEPTION 'session_expired' USING ERRCODE='PT401'; END IF;
 SELECT p.invoice_path INTO v_path FROM public.purchase_orders p WHERE p.id=p_po_id AND p.deleted_at IS NULL
  AND public.has_permission(v_auth_id,'purchasing.po.read');
 IF v_path IS NULL THEN RAISE EXCEPTION 'invoice_not_found' USING ERRCODE='P0002'; END IF;
 RETURN v_path;
END $$;
REVOKE ALL ON FUNCTION public.authorize_po_invoice_download_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authorize_po_invoice_download_v1(uuid,uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
