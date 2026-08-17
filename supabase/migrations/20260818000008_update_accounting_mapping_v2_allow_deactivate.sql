-- 20260818000008_update_accounting_mapping_v2_allow_deactivate.sql
--
-- Trou de conception découvert en exécutant le Lot C de l'audit accounting
-- (2026-08-17) : update_accounting_mapping_v1 valide `is_active AND
-- deleted_at IS NULL` + `is_postable` du compte CIBLE inconditionnellement —
-- y compris quand p_is_active = false. Conséquence : un mapping qui pointe
-- déjà vers un compte désactivé devient indésactivable (cas réel :
-- EXPENSE_VAT_INPUT / PURCHASE_VAT_INPUT → 1151, désactivé NON-PKP par
-- ADR-005). Le trou resurgirait à chaque désactivation d'un compte encore
-- mappé.
--
-- Décision (arbitrée par Mamat) : bump _v2 où la validation actif+postable ne
-- s'applique QUE quand p_is_active = true. L'existence du compte
-- (account_code_unknown) reste validée dans tous les cas — un mapping ne
-- doit jamais pointer vers un code inexistant. Aucun autre changement de
-- logique. Corps repris verbatim du live pg_get_functiondef (relevé
-- 2026-08-17), messages d'exception renommés update_accounting_mapping_v2.
--
-- RPC versioning monotone (CLAUDE.md) : DROP de _v1 dans la même migration.

-- ============================================================================
-- update_accounting_mapping_v2 — actif+postable exigés seulement si p_is_active
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_accounting_mapping_v2(
  p_mapping_key  TEXT,
  p_account_code TEXT,
  p_is_active    BOOLEAN,
  p_reason       TEXT
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid       UUID := auth.uid();
  v_caller_profile   UUID;
  v_old_account_code TEXT;
  v_old_is_active    BOOLEAN;
  v_account_postable BOOLEAN;
  v_account_active   BOOLEAN;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'update_accounting_mapping_v2: caller not authenticated'
      USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_caller_profile
    FROM user_profiles
    WHERE auth_user_id = v_caller_uid
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'update_accounting_mapping_v2: caller has no active profile'
      USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'accounting.mapping.update') THEN
    RAISE EXCEPTION 'update_accounting_mapping_v2: missing permission accounting.mapping.update'
      USING ERRCODE = '42501';
  END IF;

  IF p_mapping_key IS NULL OR length(trim(p_mapping_key)) = 0 THEN
    RAISE EXCEPTION 'mapping_key_required' USING ERRCODE = 'P0002';
  END IF;

  IF p_account_code IS NULL OR length(trim(p_account_code)) = 0 THEN
    RAISE EXCEPTION 'account_code_required' USING ERRCODE = 'P0002';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_required: must be 3..200 chars' USING ERRCODE = '22001';
  END IF;

  SELECT account_code, is_active
    INTO v_old_account_code, v_old_is_active
    FROM accounting_mappings
    WHERE mapping_key = p_mapping_key
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mapping_key_not_found: %', p_mapping_key
      USING ERRCODE = 'P0002';
  END IF;

  -- L'existence du compte cible reste validée dans TOUS les cas — un mapping
  -- ne doit jamais pointer vers un code de compte inexistant, actif ou non.
  SELECT is_postable, (is_active AND deleted_at IS NULL)
    INTO v_account_postable, v_account_active
    FROM accounts
    WHERE code = p_account_code
    LIMIT 1;

  IF v_account_postable IS NULL THEN
    RAISE EXCEPTION 'account_code_unknown: %', p_account_code
      USING ERRCODE = 'P0002';
  END IF;

  -- Correctif Lot C : actif+postable ne sont exigés QUE quand on ACTIVE le
  -- mapping (p_is_active = true). v1 les exigeait inconditionnellement — y
  -- compris pour DÉSACTIVER un mapping, ce qui rendait indésactivable un
  -- mapping pointant déjà vers un compte désactivé (cas réel :
  -- EXPENSE_VAT_INPUT / PURCHASE_VAT_INPUT → 1151 inactif NON-PKP, ADR-005).
  -- Désactiver un mapping ne doit jamais exiger que sa cible soit vivante.
  IF p_is_active THEN
    IF NOT v_account_active THEN
      RAISE EXCEPTION 'account_inactive: %', p_account_code
        USING ERRCODE = '23514';
    END IF;

    IF NOT v_account_postable THEN
      RAISE EXCEPTION 'account_not_postable: %', p_account_code
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE accounting_mappings
     SET account_code = p_account_code,
         is_active    = p_is_active
   WHERE mapping_key  = p_mapping_key;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile,
    'accounting.mapping.update',
    'accounting_mapping',
    NULL,
    jsonb_build_object(
      'mapping_key',     p_mapping_key,
      'old_account_code', v_old_account_code,
      'new_account_code', p_account_code,
      'old_is_active',    v_old_is_active,
      'new_is_active',    p_is_active,
      'reason',           trim(p_reason)
    )
  );
END $function$;

COMMENT ON FUNCTION public.update_accounting_mapping_v2(TEXT, TEXT, BOOLEAN, TEXT) IS
  'Lot C (audit accounting 2026-08-17) : bump _v1→_v2 — corrige un trou de '
  'conception où v1 exigeait un compte actif+postable inconditionnellement, '
  'même pour DÉSACTIVER un mapping. v2 n''exige actif+postable que quand '
  'p_is_active = true ; l''existence du compte (account_code_unknown) reste '
  'validée dans tous les cas. Corps sinon inchangé. Permission : '
  'accounting.mapping.update. Insère une ligne audit_logs par mutation.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant (CLAUDE.md — grants anon).
REVOKE EXECUTE ON FUNCTION public.update_accounting_mapping_v2(TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_accounting_mapping_v2(TEXT, TEXT, BOOLEAN, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_accounting_mapping_v2(TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ============================================================================
-- DROP de _v1 (même migration que la création de _v2 — RPC versioning
-- monotone, CLAUDE.md).
-- ============================================================================

DROP FUNCTION public.update_accounting_mapping_v1(text, text, boolean, text);
