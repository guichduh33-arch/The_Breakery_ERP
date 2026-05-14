-- 20260517000230_create_update_mapping_rpc.sql
-- Session 13 / Phase 6.C — Accounting mappings admin UI (module 10-012).
--
-- Creates a SECURITY DEFINER RPC `update_accounting_mapping_v1` so ADMIN+
-- can rewire a symbolic JE mapping key (e.g. SALE_POS_REVENUE) to a
-- different `accounts.code`, or deactivate it. Triggered by the BO Mappings
-- page (`/backoffice/accounting/mappings`).
--
-- Schema reminder (Phase 1.A migration 000001) :
--   accounting_mappings(
--     mapping_key   TEXT PRIMARY KEY,
--     account_code  TEXT NOT NULL REFERENCES accounts(code),
--     description   TEXT,
--     is_active     BOOLEAN NOT NULL DEFAULT true,
--     created_at    TIMESTAMPTZ,
--     updated_at    TIMESTAMPTZ
--   )
--
-- D-W6-6C-03 : the INDEX spec referred to (`p_mapping_id UUID`, `p_account_id UUID`,
-- `p_postable BOOLEAN`) which does NOT match the actual schema. The RPC signature
-- here mirrors the real columns (mapping_key, account_code, is_active).
-- "Postable" is already a property of `accounts.is_postable` and is enforced
-- at the validation step below — non-postable accounts are rejected.
--
-- Permission gating: `accounting.mapping.update`. Seeded for ADMIN +
-- SUPER_ADMIN in 000030 (wildcard `INSERT … SELECT FROM permissions`). NOT
-- granted to MANAGER (read-only via `accounting.read`).
--
-- Auditing: each mutation INSERTs a row in `audit_logs` with the old and new
-- values, plus the operator's reason text.
--
-- D10/R14 lock: this migration does NOT touch `has_permission()`. The CI
-- grep gate in `.github/workflows/ci.yml` enforces that lock since
-- 20260514015204.

BEGIN;

CREATE OR REPLACE FUNCTION update_accounting_mapping_v1(
  p_mapping_key  TEXT,
  p_account_code TEXT,
  p_is_active    BOOLEAN,
  p_reason       TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid       UUID := auth.uid();
  v_caller_profile   UUID;
  v_old_account_code TEXT;
  v_old_is_active    BOOLEAN;
  v_account_postable BOOLEAN;
  v_account_active   BOOLEAN;
BEGIN
  -- 1. Auth + permission gate.
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'update_accounting_mapping_v1: caller not authenticated'
      USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_caller_profile
    FROM user_profiles
    WHERE auth_user_id = v_caller_uid
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'update_accounting_mapping_v1: caller has no active profile'
      USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'accounting.mapping.update') THEN
    RAISE EXCEPTION 'update_accounting_mapping_v1: missing permission accounting.mapping.update'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate inputs.
  IF p_mapping_key IS NULL OR length(trim(p_mapping_key)) = 0 THEN
    RAISE EXCEPTION 'mapping_key_required' USING ERRCODE = 'P0002';
  END IF;

  IF p_account_code IS NULL OR length(trim(p_account_code)) = 0 THEN
    RAISE EXCEPTION 'account_code_required' USING ERRCODE = 'P0002';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_required: must be 3..200 chars' USING ERRCODE = '22001';
  END IF;

  -- 3. Load old state.
  SELECT account_code, is_active
    INTO v_old_account_code, v_old_is_active
    FROM accounting_mappings
    WHERE mapping_key = p_mapping_key
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mapping_key_not_found: %', p_mapping_key
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validate new account exists + is postable + is active.
  --    A non-postable parent / header account would break JE creation —
  --    only `is_postable = true` accounts may back a mapping.
  SELECT is_postable, (is_active AND deleted_at IS NULL)
    INTO v_account_postable, v_account_active
    FROM accounts
    WHERE code = p_account_code
    LIMIT 1;

  IF v_account_postable IS NULL THEN
    RAISE EXCEPTION 'account_code_unknown: %', p_account_code
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_account_active THEN
    RAISE EXCEPTION 'account_inactive: %', p_account_code
      USING ERRCODE = '23514';
  END IF;

  IF NOT v_account_postable THEN
    RAISE EXCEPTION 'account_not_postable: %', p_account_code
      USING ERRCODE = '23514';
  END IF;

  -- 5. Early-exit if nothing actually changes — still log so audit shows
  --    the explicit re-approval (matches user expectations on save).
  --    Set updated_at via trigger.
  UPDATE accounting_mappings
     SET account_code = p_account_code,
         is_active    = p_is_active
   WHERE mapping_key  = p_mapping_key;

  -- 6. Audit log.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile,
    'accounting.mapping.update',
    'accounting_mapping',
    NULL, -- accounting_mappings PK is TEXT, not UUID; we use NULL + put key in metadata
    jsonb_build_object(
      'mapping_key',     p_mapping_key,
      'old_account_code', v_old_account_code,
      'new_account_code', p_account_code,
      'old_is_active',    v_old_is_active,
      'new_is_active',    p_is_active,
      'reason',           trim(p_reason)
    )
  );
END $$;

COMMENT ON FUNCTION update_accounting_mapping_v1(TEXT, TEXT, BOOLEAN, TEXT) IS
  'Phase 6.C / module 10-012 : ADMIN+ edit of accounting_mappings. '
  'Validates target account is_postable + is_active. Inserts an audit_logs row. '
  'Permission: accounting.mapping.update.';

REVOKE EXECUTE ON FUNCTION update_accounting_mapping_v1(TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION update_accounting_mapping_v1(TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

COMMIT;
