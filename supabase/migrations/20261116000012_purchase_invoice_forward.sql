-- Nouvelle API PO : réparation autorisée même après règlement complet, pièce valide payée verrouillée.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE IF NOT EXISTS public.po_invoice_results(
 idempotency_key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 po_id uuid NOT NULL REFERENCES public.purchase_orders(id),request_payload jsonb NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
DO $ledger$ BEGIN
 IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
  WHERE attrelid='public.po_invoice_results'::regclass AND attnum>0 AND NOT attisdropped)
 <> ARRAY['idempotency_key','actor_id','po_id','request_payload','result','created_at'] THEN
  RAISE EXCEPTION 'po_invoice_ledger_drift'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES('idempotency_key','uuid'::regtype),('actor_id','uuid'::regtype),
   ('po_id','uuid'::regtype),('request_payload','jsonb'::regtype),('result','jsonb'::regtype),('created_at','timestamptz'::regtype)) x(col,typ)
  JOIN pg_attribute a ON a.attrelid='public.po_invoice_results'::regclass AND a.attname=x.col
  WHERE a.atttypid<>x.typ OR NOT a.attnotnull) OR
  NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.po_invoice_results'::regclass AND relowner='postgres'::regrole AND relkind='r') OR
  NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.po_invoice_results'::regclass AND contype='p' AND conkey=ARRAY[1]::smallint[]) OR
  NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.po_invoice_results'::regclass AND contype='f' AND conkey=ARRAY[2]::smallint[]
    AND confrelid='public.user_profiles'::regclass AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.user_profiles'::regclass AND attname='id')]::smallint[]) OR
  NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.po_invoice_results'::regclass AND contype='f' AND conkey=ARRAY[3]::smallint[]
    AND confrelid='public.purchase_orders'::regclass AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.purchase_orders'::regclass AND attname='id')]::smallint[]) THEN
  RAISE EXCEPTION 'po_invoice_ledger_drift'; END IF;
END $ledger$;
CREATE INDEX IF NOT EXISTS po_invoice_results_po ON public.po_invoice_results(po_id);
CREATE INDEX IF NOT EXISTS po_invoice_results_actor ON public.po_invoice_results(actor_id);
ALTER TABLE public.po_invoice_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pin_session_required ON public.po_invoice_results;
CREATE POLICY pin_session_required ON public.po_invoice_results AS RESTRICTIVE FOR ALL TO authenticated
 USING(public.request_has_active_pin_session_v1()) WITH CHECK(public.request_has_active_pin_session_v1());
REVOKE ALL ON public.po_invoice_results FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.po_invoice_results TO service_role;
DO $old$ DECLARE f regprocedure:=to_regprocedure('public._guard_invoice_fields_v1()'); BEGIN
 IF f IS NOT NULL AND ((md5(pg_get_functiondef(f)) NOT IN ('e6377ecdd9c3d84c8087d119afc60b21') AND md5(btrim(replace(pg_get_functiondef(f),E'\r\n',E'\n'))) <> '4ce58326e0a901007321e6aa3688fdca')) THEN RAISE EXCEPTION 'invoice_definition_drift: _guard_invoice_fields_v1()'; END IF;
END $old$;
DO $old$ DECLARE f regprocedure:=to_regprocedure('public.can_upload_po_invoice_v1(uuid)'); BEGIN
 IF f IS NOT NULL AND ((SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=f) <> '28479ab754edbb055bdcb344bde8864a') THEN RAISE EXCEPTION 'invoice_definition_drift: can_upload_po_invoice_v1(uuid)'; END IF;
END $old$;
DO $old$ DECLARE f regprocedure:=to_regprocedure('public.set_po_invoice_v1(uuid,text,text,uuid)'); BEGIN
 IF f IS NOT NULL AND ((SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=f) <> 'd3ee58fc17386373beb4213da5566b1f') THEN RAISE EXCEPTION 'invoice_definition_drift: set_po_invoice_v1(uuid,text,text,uuid)'; END IF;
END $old$;
DO $adopt$ DECLARE f regprocedure:=to_regprocedure('public.storage_path_to_po_id_v1(text)'); BEGIN
 IF f IS NULL THEN EXECUTE $definition$CREATE FUNCTION public.storage_path_to_po_id_v1(p_path text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
BEGIN
 IF split_part(p_path,'/',1)<>'purchase-orders' THEN RETURN NULL; END IF;
 RETURN split_part(p_path,'/',2)::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;$definition$;
 ELSIF (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=f) <> '94924eb6b462a519adb86c54464ebba3' THEN RAISE EXCEPTION 'invoice_definition_drift: storage_path_to_po_id_v1(text)'; END IF;
END $adopt$;
REVOKE ALL ON FUNCTION public.storage_path_to_po_id_v1(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_path_to_po_id_v1(text) TO authenticated,service_role;
CREATE FUNCTION public.can_upload_po_invoice_v2(p_po_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(auth.uid() IS NOT NULL AND public.request_has_active_pin_session_v1()
 AND (public.has_permission(auth.uid(),'purchasing.po.create') OR public.has_permission(auth.uid(),'purchasing.po.pay'))
 AND EXISTS(SELECT 1 FROM public.purchase_orders p WHERE p.id=p_po_id AND p.deleted_at IS NULL AND p.status<>'cancelled'
  AND (NOT EXISTS(SELECT 1 FROM public.purchase_payments x WHERE x.purchase_order_id=p.id)
   OR NOT public._payment_invoice_valid_v1('purchase-invoices',p.invoice_path,'purchase-orders/'||p.id||'/'))),false)
$$;
CREATE FUNCTION public.set_po_invoice_v2(p_po_id uuid,p_storage_path text DEFAULT NULL,
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
 ELSIF NOT public.can_upload_po_invoice_v2(p.id)
   OR (v_path IS NULL AND EXISTS(SELECT 1 FROM public.purchase_payments WHERE purchase_order_id=p.id))
   OR p.invoice_path IS DISTINCT FROM NULLIF(p_expected_path,'') THEN
  v_result:=jsonb_build_object('po_id',p.id,'invoice_path',p.invoice_path,'applied',false,'idempotent_replay',false,
   'reason',CASE WHEN NOT public.can_upload_po_invoice_v2(p.id)
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
CREATE FUNCTION public._guard_invoice_fields_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF (TG_OP='INSERT' AND NEW.invoice_exempt) OR
    (TG_OP='UPDATE' AND NEW.invoice_exempt IS DISTINCT FROM OLD.invoice_exempt) THEN
  RAISE EXCEPTION 'invoice_exemption_immutable' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='purchase_orders' THEN
  IF TG_OP='INSERT' AND NEW.invoice_path IS NOT NULL THEN
   RAISE EXCEPTION 'invoice_requires_saved_order' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' AND NEW.invoice_path IS DISTINCT FROM OLD.invoice_path THEN
   IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'invoice_requires_rpc' USING ERRCODE='42501';
   END IF;
   IF public._payment_invoice_valid_v1('purchase-invoices',OLD.invoice_path,'purchase-orders/'||OLD.id||'/') AND EXISTS(SELECT 1 FROM public.purchase_payments WHERE purchase_order_id=OLD.id) THEN
    RAISE EXCEPTION 'invoice_locked_after_payment' USING ERRCODE='22023';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $function$;
DO $adopt$ DECLARE f regprocedure:=to_regprocedure('public.authorize_po_invoice_download_v1(uuid,uuid)'); BEGIN
 IF f IS NULL THEN EXECUTE $definition$CREATE FUNCTION public.authorize_po_invoice_download_v1(p_session_id uuid,p_po_id uuid) RETURNS text
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
END $$;$definition$;
 ELSIF (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=f) <> '9b7f907f195a7f8f0a8bdb093ce950e7' THEN RAISE EXCEPTION 'invoice_definition_drift: authorize_po_invoice_download_v1(uuid,uuid)'; END IF;
END $adopt$;
REVOKE ALL ON FUNCTION public.authorize_po_invoice_download_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authorize_po_invoice_download_v1(uuid,uuid) TO service_role;
DROP POLICY IF EXISTS purchase_invoices_insert ON storage.objects;
CREATE POLICY purchase_invoices_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='purchase-invoices' AND name ~ '^purchase-orders/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|pdf)$'
 AND public.can_upload_po_invoice_v2(public.storage_path_to_po_id_v1(name)));
DROP POLICY IF EXISTS purchase_invoices_proxy_only ON storage.objects;
CREATE POLICY purchase_invoices_proxy_only ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(bucket_id<>'purchase-invoices');
DROP TRIGGER IF EXISTS invoice_fields_guard ON public.purchase_orders;
DROP TRIGGER IF EXISTS invoice_fields_guard ON public.expenses;
CREATE TRIGGER invoice_fields_guard BEFORE INSERT OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public._guard_invoice_fields_v2();
CREATE TRIGGER invoice_fields_guard BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public._guard_invoice_fields_v2();
DROP TRIGGER IF EXISTS invoice_required_before_payment ON public.purchase_payments;
CREATE TRIGGER invoice_required_before_payment BEFORE INSERT ON public.purchase_payments FOR EACH ROW EXECUTE FUNCTION public._guard_po_payment_invoice_v1();
DROP FUNCTION IF EXISTS public._guard_invoice_fields_v1();
DROP FUNCTION IF EXISTS public.set_po_invoice_v1(uuid,text,text,uuid);
DROP FUNCTION IF EXISTS public.can_upload_po_invoice_v1(uuid);
REVOKE ALL ON FUNCTION public.can_upload_po_invoice_v2(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_upload_po_invoice_v2(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_po_invoice_v2(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_po_invoice_v2(uuid,text,text,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public._guard_invoice_fields_v2() FROM PUBLIC,anon,authenticated,service_role;
