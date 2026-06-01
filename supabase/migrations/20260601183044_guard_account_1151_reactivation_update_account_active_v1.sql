-- 20260601183044_guard_account_1151_reactivation_update_account_active_v1.sql
-- Audit fix M1 (2026-06-01) — block re-activating account 1151 (VAT Input),
-- permanently disabled per ADR-003 NON-PKP. Re-activating it would silently
-- re-enable the VAT-input JE path (_emit_expense_je → resolve_mapping_account
-- 'EXPENSE_VAT_INPUT'). CREATE OR REPLACE (signature unchanged).

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

  -- M1 audit fix: ADR-003 NON-PKP — account 1151 'VAT Input' is RESERVED/disabled.
  -- Re-activating it would silently re-enable the non-recoverable VAT-input path.
  IF v_account.code = '1151' AND p_is_active THEN
    RAISE EXCEPTION 'account_1151_reserved_non_pkp: VAT Input is permanently disabled (ADR-003 NON-PKP)'
      USING ERRCODE = 'P0001';
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

COMMENT ON FUNCTION public.update_account_active_v1(UUID, BOOLEAN) IS
  'S26b cockpit + M1 audit fix 2026-06-01: toggle is_active on accounts. Gate accounting.coa.write (SUPER_ADMIN). Blocks re-activating account 1151 (ADR-003 NON-PKP). Audit_log row. No-op if already in requested state.';
