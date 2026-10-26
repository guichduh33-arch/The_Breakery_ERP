-- Le service résout l'objet depuis une session vérifiée et les droits courants.
CREATE FUNCTION public.authorize_expense_receipt_download_v1(p_session_id uuid, p_expense_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile_id uuid;
  v_auth_id uuid;
  v_path text;
BEGIN
  SELECT p.id, p.auth_user_id INTO v_profile_id, v_auth_id
  FROM public.user_sessions s JOIN public.user_profiles p ON p.id = s.user_id
  WHERE s.id = p_session_id;
  IF v_auth_id IS NULL OR NOT public.is_pin_session_active_v1(p_session_id, v_auth_id) THEN
    RAISE EXCEPTION 'session_expired' USING ERRCODE = 'PT401';
  END IF;
  SELECT e.receipt_url INTO v_path FROM public.expenses e
  WHERE e.id = p_expense_id AND e.deleted_at IS NULL
    AND (e.created_by = v_profile_id
      OR public.has_permission(v_auth_id, 'expenses.read')
      OR public.has_permission(v_auth_id, 'expenses.manage'));
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'receipt_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_path;
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_expense_receipt_download_v1(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_expense_receipt_download_v1(uuid,uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Une policy permissive future ne doit pas rouvrir le téléchargement direct.
CREATE POLICY expense_receipts_proxy_only ON storage.objects AS RESTRICTIVE
FOR SELECT TO anon, authenticated USING (bucket_id <> 'expense-receipts');
