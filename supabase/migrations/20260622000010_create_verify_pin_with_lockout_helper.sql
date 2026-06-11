-- 20260622000010_create_verify_pin_with_lockout_helper.sql
-- Session 38 / Wave A / Task A1 (SEC-06) — helper interne _verify_pin_with_lockout.
--
-- Context : les RPCs qui valident un PIN via l'arg `p_manager_pin` appelaient jusqu'ici
-- `verify_user_pin` (STABLE, pure comparaison bcrypt, migration 20260503000006) qui ne compte
-- jamais les échecs ni ne vérifie `locked_until` → brute-force illimité par un cashier authentifié.
-- Les colonnes `user_profiles.failed_login_attempts INT NOT NULL DEFAULT 0` et
-- `locked_until TIMESTAMPTZ` existent depuis la migration initiale (20260503000001) mais n'étaient
-- exploitées que par l'EF `auth-verify-pin` (5 échecs → 15 min lockout).
--
-- Ce helper réplique la politique de l'EF au niveau SQL pour les RPCs PIN-in-arg :
--   - Vérifie `locked_until` → P0004 `account_locked` si actif.
--   - Succès : reset failed_login_attempts + locked_until.
--   - Échec : incrémente failed_login_attempts ; sur le 5e échec, pose locked_until = now() + 15 min
--     et insère un audit_logs `pin.locked`.
--   - Tout échec : insère un audit_logs `pin.failed`.
--
-- Important : NE PAS toucher à `verify_user_pin` (l'EF login et manager-pin.ts en dépendent).
-- Ce helper est PRIVÉ — REVOKE ALL PUBLIC + anon + authenticated.

CREATE OR REPLACE FUNCTION public._verify_pin_with_lockout(p_user_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash      TEXT;
  v_attempts  INT;
  v_locked    TIMESTAMPTZ;
  v_new       INT;
BEGIN
  SELECT pin_hash, failed_login_attempts, locked_until
    INTO v_hash, v_attempts, v_locked
    FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL;

  IF v_hash IS NULL THEN
    RETURN false;  -- profil absent / sans PIN : pas d'énumération, pas de comptage
  END IF;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RAISE EXCEPTION 'account_locked' USING ERRCODE = 'P0004';
  END IF;

  IF v_hash = crypt(p_pin, v_hash) THEN
    UPDATE user_profiles SET failed_login_attempts = 0, locked_until = NULL WHERE id = p_user_id;
    RETURN true;
  END IF;

  v_new := COALESCE(v_attempts, 0) + 1;
  IF v_new >= 5 THEN
    UPDATE user_profiles SET failed_login_attempts = v_new, locked_until = now() + interval '15 minutes' WHERE id = p_user_id;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_user_id, 'pin.locked', 'user_profiles', p_user_id, jsonb_build_object('attempts', v_new, 'source', 'rpc'));
  ELSE
    UPDATE user_profiles SET failed_login_attempts = v_new WHERE id = p_user_id;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_user_id, 'pin.failed', 'user_profiles', p_user_id, jsonb_build_object('attempts', v_new, 'source', 'rpc'));
  END IF;
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public._verify_pin_with_lockout(UUID, TEXT) IS
  'S38 SEC-06 — validation PIN avec comptage d''échecs + lockout 5/15min. Helper interne : appelé uniquement par les RPCs SECURITY DEFINER PIN-in-arg. P0004 = account_locked (distinct de P0003 invalid_pin).';

REVOKE ALL ON FUNCTION public._verify_pin_with_lockout(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._verify_pin_with_lockout(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._verify_pin_with_lockout(UUID, TEXT) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
