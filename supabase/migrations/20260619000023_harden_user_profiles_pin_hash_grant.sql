-- 20260619000023_harden_user_profiles_pin_hash_grant.sql
-- Security hardening (security-fraud-guard audit 2026-05-31, Pattern #10 / checklist D).
--
-- GAP 3 — user_profiles.pin_hash is readable by `authenticated`.
-- has_column_privilege('authenticated','user_profiles','pin_hash','SELECT')=true
-- (verified live), because Supabase auto-grants table-level SELECT and that grant
-- covers every column regardless of any column-level REVOKE (same trap as the S12
-- customers column-grant fix, 20260515000001). Any authenticated role (CASHIER
-- included) could therefore read every bcrypt hash and:
--   (a) brute-force manager PINs offline (6-digit space, cost-10 bcrypt), and
--   (b) harvest manager profile UUIDs feeding the reversal-bypass vector
--       (security-fraud-guard Pattern #4).
--
-- Fix: drop the table-level SELECT grant and re-grant SELECT on every column
-- EXCEPT pin_hash. Auth flows that need pin_hash (auth-verify-pin, auth-change-pin,
-- verify_user_pin via manager-pin.ts) all run as service_role (getAdminClient) and
-- are unaffected. RLS helper subqueries on user_profiles only read
-- id/auth_user_id/role_code — all still granted. INSERT/UPDATE/DELETE grants are
-- left untouched (governed by RLS; no direct authenticated write path exists).
--
-- Verified before shipping: no application code reads user_profiles via an
-- authenticated PostgREST client (grep `.from('user_profiles')` in apps/packages
-- → no matches); pin_hash is referenced only in service-role EF code.

REVOKE SELECT ON public.user_profiles FROM authenticated;

GRANT SELECT (
  id,
  auth_user_id,
  employee_code,
  full_name,
  role_code,
  is_active,
  failed_login_attempts,
  locked_until,
  last_login_at,
  created_at,
  updated_at,
  deleted_at
) ON public.user_profiles TO authenticated;

COMMENT ON COLUMN public.user_profiles.pin_hash IS
  'bcrypt PIN hash. NOT SELECT-able by authenticated (column grant excludes it). '
  'Read only by service_role auth flows (auth-verify-pin, auth-change-pin, verify_user_pin).';
