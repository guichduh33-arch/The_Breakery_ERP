-- 20260710000099_list_login_users_v1.sql
-- Vague 0 / Tâche 3a — réparer la chaîne d'embauche (fiche 01 D2.1).
--
-- Problem : both POS and BO login pages ship a UserPicker hardcoded to the
-- 2 seed accounts (`00000000-0000-0000-0000-000000000001/002`). Any employee
-- created via the BackOffice `UserFormDialog` (`create_user_v1`) is
-- invisible at login and effectively cannot sign in.
--
-- Fix : a new anon-callable RPC that lists active, non-deleted staff for the
-- pre-auth login picker. This is a NEW function (list_login_users_v1) — no
-- prior version to drop, no signature to preserve.
--
-- Exposure is intentionally minimal : id + display name + role label only.
-- NOT exposed : employee_code, pin_hash, failed_login_attempts, locked_until,
-- last_login_at, auth_user_id, created_at/updated_at. None of the current
-- UserPicker implementations render employee_code, so it is not included.
--
-- Anon-callable by necessity (S20 pattern) : the client has no PIN JWT yet
-- when rendering the login picker, so it queries with the anon key. This is
-- the FIRST legitimate anon-callable function on this project since the S20
-- anon defense-in-depth sweep (`REVOKE ALL FROM PUBLIC` is project-wide
-- default) — `supabase/tests/security_anon_grants.test.sql` A2 previously
-- asserted a hard zero; it is updated in the same session to carve out this
-- one function by name, with a companion positive-check suite
-- (`list_login_users.test.sql`) so the exception can't silently widen.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_login_users_v1()
RETURNS TABLE (
  id           UUID,
  display_name TEXT,
  role         TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT up.id, up.full_name AS display_name, r.name AS role
    FROM public.user_profiles up
    JOIN public.roles r ON r.code = up.role_code
   WHERE up.is_active = true
     AND up.deleted_at IS NULL
   ORDER BY up.full_name ASC
   LIMIT 100
$$;

-- S20 anon defense-in-depth pattern : REVOKE ALL FROM PUBLIC first, then
-- explicit per-role GRANTs. anon needs EXECUTE here (pre-auth picker) —
-- authenticated too (already-signed-in staff opening a second session /
-- switching user on a shared terminal reuse the same picker).
REVOKE ALL ON FUNCTION public.list_login_users_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_login_users_v1() FROM anon;
REVOKE ALL ON FUNCTION public.list_login_users_v1() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_login_users_v1() TO anon;
GRANT EXECUTE ON FUNCTION public.list_login_users_v1() TO authenticated;

COMMENT ON FUNCTION public.list_login_users_v1() IS
  'anon-callable: pre-auth login user picker — minimal exposure (id, name, role)';

COMMIT;
