-- 20260503000001_init_auth.sql
-- Phase 2 / migration 2 : tables auth & users

-- ROLES (catalogue)
CREATE TABLE roles (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PERMISSIONS (catalogue)
CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- USER PROFILES (identité applicative)
CREATE TABLE user_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id           UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_code          TEXT UNIQUE NOT NULL,
  full_name              TEXT NOT NULL,
  pin_hash               TEXT NOT NULL,
  role_code              TEXT NOT NULL REFERENCES roles(code),
  is_active              BOOLEAN NOT NULL DEFAULT true,
  failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX idx_user_profiles_auth_user ON user_profiles(auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_profiles_active ON user_profiles(is_active, deleted_at);

-- USER SESSIONS (custom session token, hashé par trigger)
CREATE TABLE user_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES user_profiles(id),
  session_token_hash   TEXT NOT NULL UNIQUE,
  device_type          TEXT NOT NULL,
  ip_address           INET,
  user_agent           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ,
  end_reason           TEXT
);

CREATE INDEX idx_user_sessions_active ON user_sessions(session_token_hash) WHERE ended_at IS NULL;
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, ended_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER user_profiles_set_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE roles          IS 'Catalogue des rôles (SUPER_ADMIN, ADMIN, MANAGER, CASHIER)';
COMMENT ON TABLE permissions    IS 'Catalogue des permissions (module.action)';
COMMENT ON TABLE user_profiles  IS 'Identité applicative + PIN bcrypt';
COMMENT ON TABLE user_sessions  IS 'Sessions actives (token SHA-256)';
