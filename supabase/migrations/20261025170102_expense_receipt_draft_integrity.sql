-- Brouillon durable, rattachement verrouillé et justificatifs privés immuables.
-- Identité de création distincte de la clé de soumission ; aucune reprise globale de l'historique.
CREATE TABLE public.expense_creation_results(
 idempotency_key uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 expense_id uuid NOT NULL UNIQUE REFERENCES public.expenses(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.expense_creation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY pin_session_required ON public.expense_creation_results AS RESTRICTIVE FOR ALL TO authenticated
 USING((SELECT public.request_has_active_pin_session_v1()))
 WITH CHECK((SELECT public.request_has_active_pin_session_v1()));
REVOKE ALL ON public.expense_creation_results FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.expense_creation_results TO service_role;

CREATE TABLE public.expense_receipt_results(
 idempotency_key uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 expense_id uuid NOT NULL REFERENCES public.expenses(id),
 request_payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.expense_receipt_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY pin_session_required ON public.expense_receipt_results AS RESTRICTIVE FOR ALL TO authenticated
 USING((SELECT public.request_has_active_pin_session_v1()))
 WITH CHECK((SELECT public.request_has_active_pin_session_v1()));
REVOKE ALL ON public.expense_receipt_results FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.expense_receipt_results TO service_role;
CREATE FUNCTION public._read_expense_receipt_v1(p_key uuid,p_actor uuid,p_expense uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE v_result public.expense_receipt_results%ROWTYPE;
BEGIN
 SELECT * INTO v_result FROM public.expense_receipt_results WHERE idempotency_key=p_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_result.actor_id IS DISTINCT FROM p_actor OR v_result.expense_id IS DISTINCT FROM p_expense
    OR v_result.request_payload IS DISTINCT FROM p_request THEN
   RAISE EXCEPTION 'expense_receipt_key_conflict' USING ERRCODE='22023';
 END IF;
 RETURN v_result.result || jsonb_build_object('idempotent_replay',true);
END $$;

CREATE FUNCTION public._read_expense_creation_v1(p_key uuid, p_profile uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_row public.expenses%ROWTYPE; v_actor uuid; v_expense uuid;
BEGIN
  IF p_key IS NULL THEN RETURN NULL; END IF;
  SELECT r.expense_id,r.actor_id INTO v_expense,v_actor
   FROM public.expense_creation_results r WHERE r.idempotency_key=p_key;
  IF FOUND THEN
    SELECT * INTO STRICT v_row FROM public.expenses WHERE id=v_expense;
  ELSE
    -- Une clé encore portée par un brouillon ancien est vérifiable sans réécrire son historique.
    SELECT * INTO v_row FROM public.expenses e
     WHERE e.idempotency_key=p_key AND e.status='draft'
       AND NOT EXISTS(SELECT 1 FROM public.expense_creation_results r WHERE r.expense_id=e.id);
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_actor:=v_row.created_by;
  END IF;
  IF v_actor IS DISTINCT FROM p_profile OR v_row.created_by IS DISTINCT FROM p_profile
     OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'expense_creation_key_conflict' USING ERRCODE='22023';
  END IF;
  RETURN v_row.id;
END $$;
CREATE OR REPLACE FUNCTION public.create_expense_v3(p_category_id uuid, p_amount numeric, p_payment_method text, p_description text, p_expense_date date, p_vat_amount numeric DEFAULT 0, p_vendor_name text DEFAULT NULL::text, p_receipt_url text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_existing_id    UUID;
  v_new_id         UUID;
  v_expense_no     TEXT;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'create_expense_v3: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.create')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'create_expense_v3: missing permission expenses.create' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'create_expense_v3: amount must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_vat_amount < 0 THEN
    RAISE EXCEPTION 'create_expense_v3: vat_amount must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method NOT IN ('cash','transfer','card','credit') THEN
    RAISE EXCEPTION 'create_expense_v3: invalid payment_method %', p_payment_method USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'create_expense_v3: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  v_existing_id := _read_expense_creation_v1(p_idempotency_key, v_caller_profile);
  IF v_existing_id IS NOT NULL THEN
    INSERT INTO public.expense_creation_results(idempotency_key,actor_id,expense_id)
      VALUES(p_idempotency_key,v_caller_profile,v_existing_id) ON CONFLICT(idempotency_key) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
      VALUES(v_caller_profile,'expense.creation_recovered','expense',v_existing_id,
        jsonb_build_object('legacy_draft',true));
    END IF;
    RETURN public._read_expense_creation_v1(p_idempotency_key,v_caller_profile);
  END IF;
  IF NULLIF(p_receipt_url, '') IS NOT NULL THEN
    RAISE EXCEPTION 'receipt_requires_saved_draft' USING ERRCODE = '22023';
  END IF;



  v_expense_no := next_expense_number(p_expense_date);

  BEGIN
  INSERT INTO expenses (
    expense_number, category_id, amount, vat_amount, payment_method,
    description, vendor_name, expense_date, receipt_url, status,
    created_by, idempotency_key
  ) VALUES (
    v_expense_no, p_category_id, p_amount, p_vat_amount, p_payment_method,
    p_description, p_vendor_name, p_expense_date, NULL, 'draft',
    v_caller_profile, p_idempotency_key
  )
  RETURNING id INTO v_new_id;
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.expense_creation_results(idempotency_key,actor_id,expense_id)
    VALUES(p_idempotency_key,v_caller_profile,v_new_id);
  END IF;
  EXCEPTION WHEN unique_violation THEN
    v_existing_id := _read_expense_creation_v1(p_idempotency_key, v_caller_profile);
    IF v_existing_id IS NULL THEN RAISE; END IF;
    RETURN v_existing_id;
  END;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_profile, 'expense.create', 'expense', v_new_id,
          jsonb_build_object('expense_number', v_expense_no, 'amount', p_amount));

  RETURN v_new_id;
END $function$
;
CREATE FUNCTION public.set_expense_receipt_v1(
  p_expense_id uuid, p_storage_path text DEFAULT NULL, p_expected_path text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_profile uuid; v_row public.expenses%ROWTYPE; v_path text := NULLIF(p_storage_path, '');
  v_metadata jsonb; v_owner text; v_mime text; v_request jsonb; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  v_profile := public._current_profile_id();
  IF v_profile IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='28000'; END IF;
  IF NOT (public.has_permission(auth.uid(),'expenses.create')
          OR public.has_permission(auth.uid(),'expenses.manage')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.expenses WHERE id=p_expense_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE='P0002'; END IF;
  IF v_row.created_by IS DISTINCT FROM v_profile
     AND NOT public.has_permission(auth.uid(),'expenses.manage') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'receipt_key_required' USING ERRCODE='22023';
  END IF;
  v_request:=jsonb_build_object('storage_path',v_path,'expected_path',NULLIF(p_expected_path,''));
  v_result:=public._read_expense_receipt_v1(p_idempotency_key,v_profile,v_row.id,v_request);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  -- Le verrou de ligne sérialise la soumission et les changements de référence.
  BEGIN
  IF NULLIF(v_row.receipt_url,'') IS NOT DISTINCT FROM v_path THEN
    v_result:=jsonb_build_object('expense_id',v_row.id,'receipt_path',v_path,'applied',true,'idempotent_replay',true);
    INSERT INTO public.expense_receipt_results(idempotency_key,actor_id,expense_id,request_payload,result)
    VALUES(p_idempotency_key,v_profile,v_row.id,v_request,v_result);
    RETURN v_result;
  END IF;
  IF v_row.status <> 'draft'
     OR NULLIF(v_row.receipt_url,'') IS DISTINCT FROM NULLIF(p_expected_path,'') THEN
    -- Sous verrou, l'absence de résultat prouve que cette clé n'a jamais modifié la référence.
    v_result:=jsonb_build_object('expense_id',v_row.id,'receipt_path',v_row.receipt_url,
      'applied',false,'idempotent_replay',false,
      'reason',CASE WHEN v_row.status<>'draft' THEN 'receipt_requires_draft' ELSE 'receipt_changed' END);
    INSERT INTO public.expense_receipt_results(idempotency_key,actor_id,expense_id,request_payload,result)
    VALUES(p_idempotency_key,v_profile,v_row.id,v_request,v_result);
    RETURN v_result;
  END IF;
  IF v_path IS NOT NULL THEN
    IF v_path !~ '^expenses/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|pdf)$'
       OR public.storage_path_to_expense_id(v_path) IS DISTINCT FROM v_row.id THEN
      RAISE EXCEPTION 'invalid_receipt_path' USING ERRCODE='22023';
    END IF;
    IF split_part(split_part(v_path,'/',3),'.',1)::uuid IS DISTINCT FROM p_idempotency_key THEN
      RAISE EXCEPTION 'receipt_path_key_mismatch' USING ERRCODE='22023';
    END IF;
    SELECT metadata,COALESCE(NULLIF(owner_id,''),owner::text) INTO v_metadata,v_owner
    FROM storage.objects WHERE bucket_id='expense-receipts' AND name=v_path
      AND archived_at IS NULL AND NOT COALESCE(is_delete_marker,false);
    IF NOT FOUND THEN RAISE EXCEPTION 'receipt_object_not_found' USING ERRCODE='P0002'; END IF;
    IF v_owner IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'receipt_object_owner_mismatch' USING ERRCODE='42501';
    END IF;
    v_mime := v_metadata->>'mimetype';
    IF v_mime IS NULL OR v_mime NOT IN ('image/jpeg','image/png','image/webp','application/pdf')
       OR COALESCE(v_metadata->>'size','') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_receipt_file' USING ERRCODE='22023';
    END IF;
    IF (v_metadata->>'size')::numeric > 5242880
       OR (v_mime='image/jpeg' AND v_path !~ '[.](jpg|jpeg)$')
       OR (v_mime='image/png' AND v_path !~ '[.]png$')
       OR (v_mime='image/webp' AND v_path !~ '[.]webp$')
       OR (v_mime='application/pdf' AND v_path !~ '[.]pdf$') THEN
      RAISE EXCEPTION 'invalid_receipt_file' USING ERRCODE='22023';
    END IF;
  END IF;
  UPDATE public.expenses SET receipt_url=v_path WHERE id=v_row.id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
  VALUES(v_profile,'expense.receipt_updated','expense',v_row.id,
    jsonb_build_object('expense_number',v_row.expense_number),
    jsonb_build_object('receipt_url',jsonb_build_object('from',v_row.receipt_url,'to',v_path)));
  v_result:=jsonb_build_object('expense_id',v_row.id,'receipt_path',v_path,'applied',true,'idempotent_replay',false);
  INSERT INTO public.expense_receipt_results(idempotency_key,actor_id,expense_id,request_payload,result)
  VALUES(p_idempotency_key,v_profile,v_row.id,v_request,v_result);
  RETURN v_result;
  EXCEPTION WHEN unique_violation THEN
    v_result:=public._read_expense_receipt_v1(p_idempotency_key,v_profile,v_row.id,v_request);
    IF v_result IS NULL THEN RAISE; END IF;
    RETURN v_result;
  END;
END $$;
-- Les mutations passent par les RPC ; une URL ni la clé de création ne sont éditables directement.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.expenses FROM PUBLIC,anon,authenticated;
DROP POLICY expenses_insert_creator_or_manager ON public.expenses;
DROP POLICY expenses_update_own_draft ON public.expenses;
DROP POLICY expenses_select_auth ON public.expenses;
CREATE POLICY expenses_select_auth ON public.expenses FOR SELECT TO authenticated USING (
 deleted_at IS NULL AND (public.has_permission(auth.uid(),'expenses.read')
 OR public.has_permission(auth.uid(),'expenses.manage') OR created_by=(SELECT public.get_current_profile_id()))
);
DROP POLICY expense_approvals_select_auth ON public.expense_approvals;
CREATE POLICY expense_approvals_select_auth ON public.expense_approvals FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.expenses e WHERE e.id=expense_id)
);
DROP POLICY expense_receipts_insert ON storage.objects;
DROP POLICY expense_receipts_select ON storage.objects;
DROP POLICY expense_receipts_update ON storage.objects;
DROP POLICY expense_receipts_delete ON storage.objects;
CREATE POLICY expense_receipts_select ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id='expense-receipts' AND EXISTS(
  SELECT 1 FROM public.expenses e WHERE e.receipt_url=name)
);
CREATE POLICY expense_receipts_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
 bucket_id='expense-receipts'
 AND name ~ '^expenses/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|pdf)$'
 AND EXISTS(SELECT 1 FROM public.expenses e
  WHERE e.id=public.storage_path_to_expense_id(name) AND e.status='draft'
   AND (public.has_permission(auth.uid(),'expenses.manage')
    OR (e.created_by=(SELECT public.get_current_profile_id()) AND public.has_permission(auth.uid(),'expenses.create'))))
);
-- La policy restrictive PIN existante reste en place sur chaque table.

REVOKE ALL ON FUNCTION public._read_expense_creation_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._read_expense_creation_v1(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.create_expense_v3(uuid,numeric,text,text,date,numeric,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_expense_v3(uuid,numeric,text,text,date,numeric,text,text,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_expense_receipt_v1(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_expense_receipt_v1(uuid,text,text,uuid) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.create_expense_v2(uuid,numeric,text,text,date,numeric,text,text,uuid);
REVOKE ALL ON FUNCTION public._read_expense_receipt_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._read_expense_receipt_v1(uuid,uuid,uuid,jsonb) TO service_role;
