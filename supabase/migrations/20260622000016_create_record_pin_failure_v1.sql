-- 20260622000016_create_record_pin_failure_v1.sql
-- Session 38 / Wave A / Task A2bis (SEC-06, DEV-S38-A-02) — comptage d'échec PIN hors transaction RPC.
--
-- DÉCOUVERTE : PostgREST enveloppe chaque appel RPC dans UNE transaction. Quand une RPC
-- PIN-in-arg raise 'invalid_pin' (P0003) APRÈS que _verify_pin_with_lockout a incrémenté
-- failed_login_attempts, le rollback de la transaction EFFACE l'incrément. Le comptage
-- in-RPC ne persiste donc jamais sur un appel en échec — seul le gate locked_until (P0004,
-- lecture seule) est effectif sur ces chemins.
--
-- Ce RPC permet le comptage DANS UNE TRANSACTION SÉPARÉE, par un appelant de confiance
-- (Edge Function service_role) qui observe l'échec P0003 de la RPC métier puis enregistre
-- l'échec dans son propre appel (qui commit). Consommateur S38 : l'EF process-payment
-- (PIN discount de p_discount_authorized_by, chemin money-flow).
--
-- _verify_pin_with_lockout est réécrit pour déléguer sa branche échec à ce RPC
-- (source unique de la politique 5 échecs / 15 min).

CREATE OR REPLACE FUNCTION public.record_pin_failure_v1(p_user_id UUID, p_source TEXT DEFAULT 'ef')
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_exists  BOOLEAN;
  v_new     INT;
  v_locked  BOOLEAN := false;
BEGIN
  SELECT true INTO v_exists FROM user_profiles WHERE id = p_user_id AND deleted_at IS NULL;
  IF v_exists IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  UPDATE user_profiles
     SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1
   WHERE id = p_user_id
  RETURNING failed_login_attempts INTO v_new;

  IF v_new >= 5 THEN
    UPDATE user_profiles SET locked_until = now() + interval '15 minutes' WHERE id = p_user_id;
    v_locked := true;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_user_id, 'pin.locked', 'user_profiles', p_user_id,
            jsonb_build_object('attempts', v_new, 'source', p_source));
  ELSE
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_user_id, 'pin.failed', 'user_profiles', p_user_id,
            jsonb_build_object('attempts', v_new, 'source', p_source));
  END IF;

  RETURN jsonb_build_object('ok', true, 'attempts', v_new, 'locked', v_locked);
END;
$$;

COMMENT ON FUNCTION public.record_pin_failure_v1(UUID, TEXT) IS
  'S38 SEC-06 — enregistre un échec PIN dans une transaction séparée (appelé par les EFs '
  'service_role après avoir observé un P0003 de la RPC métier — le comptage in-RPC est '
  'rollbacké avec le raise, DEV-S38-A-02). 5 échecs → locked_until +15 min. service_role only.';

REVOKE ALL ON FUNCTION public.record_pin_failure_v1(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_pin_failure_v1(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_pin_failure_v1(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_pin_failure_v1(UUID, TEXT) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Réécriture du helper : branche échec déléguée (politique unique).
CREATE OR REPLACE FUNCTION public._verify_pin_with_lockout(p_user_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash    TEXT;
  v_locked  TIMESTAMPTZ;
BEGIN
  SELECT pin_hash, locked_until INTO v_hash, v_locked
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

  -- NB : si l'appelant (RPC) raise ensuite P0003, cet enregistrement est rollbacké avec la
  -- transaction PostgREST (DEV-S38-A-02). Il persiste pour tout appelant qui commit.
  PERFORM record_pin_failure_v1(p_user_id, 'rpc');
  RETURN false;
END;
$$;
