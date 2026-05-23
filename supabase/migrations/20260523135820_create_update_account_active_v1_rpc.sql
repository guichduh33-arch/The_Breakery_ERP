-- 20260604000010_create_update_account_active_v1_rpc.sql
-- Session 26b / Wave 1.A — RPC update_account_active_v1
--
-- Toggle is_active sur public.accounts depuis le cockpit ChartOfAccounts (BO).
-- La table accounts a RLS SELECT-only (auth_read) -- aucune policy WRITE existe
-- donc on encapsule l'UPDATE dans une RPC SECURITY DEFINER gated par perm
-- accounting.coa.write (SUPER_ADMIN only) + audit_log row.
--
-- Précédent : update_accounting_mapping_v1 (S13) + close_fiscal_period_v1 (S26).

CREATE OR REPLACE FUNCTION public.update_account_active_v1(
  p_account_id UUID,
  p_is_active  BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_account RECORD;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'is_active_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT public.has_permission(v_uid, 'accounting.coa.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_account
    FROM accounts
    WHERE id = p_account_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent : no-op si l'état est déjà celui demandé
  IF v_account.is_active = p_is_active THEN
    RETURN jsonb_build_object(
      'account_id',   p_account_id,
      'code',         v_account.code,
      'is_active',    p_is_active,
      'no_op',        TRUE
    );
  END IF;

  UPDATE accounts
    SET is_active  = p_is_active,
        updated_at = now()
    WHERE id = p_account_id;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'accounting.account.active_toggled',
    'accounts',
    p_account_id,
    jsonb_build_object(
      'code',          v_account.code,
      'name',          v_account.name,
      'old_is_active', v_account.is_active,
      'new_is_active', p_is_active
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'account_id', p_account_id,
    'code',       v_account.code,
    'is_active',  p_is_active,
    'no_op',      FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_account_active_v1(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_account_active_v1(UUID, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_account_active_v1(UUID, BOOLEAN) TO authenticated;

-- Défense en profondeur (S20 canonique) : idempotent re-assert
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.update_account_active_v1(UUID, BOOLEAN) IS
  'S26b cockpit : toggle is_active sur accounts. Gate accounting.coa.write '
  '(SUPER_ADMIN only). Audit_log row accounting.account.active_toggled. '
  'No-op si l''état est déjà celui demandé.';
