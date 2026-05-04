-- 20260503000006_init_helpers.sql
-- Phase 2 / migration 7 : helper functions (RLS, idr, pin)

-- Round IDR à la centaine la plus proche
CREATE OR REPLACE FUNCTION round_idr(amount DECIMAL)
RETURNS DECIMAL
LANGUAGE sql IMMUTABLE
AS $$ SELECT ROUND(amount / 100) * 100 $$;

-- is_authenticated cached helper (V2 pattern)
CREATE OR REPLACE FUNCTION is_authenticated()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL $$;

-- Hash PIN bcrypt (cost 10)
CREATE OR REPLACE FUNCTION hash_pin(p_pin TEXT)
RETURNS TEXT
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT crypt(p_pin, gen_salt('bf', 10))
$$;

-- Verify PIN
CREATE OR REPLACE FUNCTION verify_user_pin(p_user_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT pin_hash INTO v_hash FROM user_profiles WHERE id = p_user_id AND deleted_at IS NULL;
  IF v_hash IS NULL THEN
    RETURN false;
  END IF;
  RETURN v_hash = crypt(p_pin, v_hash);
END $$;

-- has_permission v1 (mapping role → perm hardcodé)
-- Session 2+ : remplacer par jointure user_roles -> role_permissions -> permissions + overrides
CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles WHERE auth_user_id = p_uid AND deleted_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN', 'ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.session.close_other',
      'pos.session.view_all','pos.sale.create','pos.sale.void','pos.sale.update',
      'products.read','products.create','products.update'
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.sale.create','products.read'
    )
    ELSE false
  END;
END $$;

-- Trigger : hash session token et clear plaintext
CREATE OR REPLACE FUNCTION hash_session_token_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_token_hash IS NOT NULL AND length(NEW.session_token_hash) = 36 THEN
    -- Si on insère le UUID v4 brut (36 chars), on le hash en SHA-256 (64 hex chars)
    NEW.session_token_hash := encode(digest(NEW.session_token_hash, 'sha256'), 'hex');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER user_sessions_hash_token
  BEFORE INSERT ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION hash_session_token_trigger();

COMMENT ON FUNCTION round_idr        IS 'Arrondi IDR à la centaine la plus proche';
COMMENT ON FUNCTION is_authenticated IS 'STABLE helper pour RLS (cached per-tx)';
COMMENT ON FUNCTION hash_pin         IS 'bcrypt cost 10';
COMMENT ON FUNCTION verify_user_pin  IS 'Comparison bcrypt PIN';
COMMENT ON FUNCTION has_permission   IS 'v1 hardcoded mapping role → permissions. Remplacé en session 2.';
