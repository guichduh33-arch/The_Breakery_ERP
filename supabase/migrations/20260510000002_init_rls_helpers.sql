-- 20260510000002_init_rls_helpers.sql
-- Session 8 — perf-debt fix D3 (helpers).
-- Helpers STABLE pour résoudre auth.uid() → user_profiles.id et role_code une seule fois par query.
-- Postgres cache l'output des fonctions STABLE pour le même set d'inputs au sein d'une query,
-- évitant le sub-SELECT par row vu dans les policies actuelles (init_rls.sql, tablet_rls.sql).

CREATE OR REPLACE FUNCTION get_current_profile_id()
  RETURNS UUID
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id FROM user_profiles
   WHERE auth_user_id = auth.uid()
     AND deleted_at IS NULL
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION get_current_role()
  RETURNS TEXT
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT role_code FROM user_profiles
   WHERE auth_user_id = auth.uid()
     AND deleted_at IS NULL
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION get_current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_role()        TO authenticated;

COMMENT ON FUNCTION get_current_profile_id() IS
  'Session 8 RLS helper: résout auth.uid() → user_profiles.id. STABLE → cached per query.';
COMMENT ON FUNCTION get_current_role() IS
  'Session 8 RLS helper: résout auth.uid() → user_profiles.role_code. STABLE → cached per query.';
