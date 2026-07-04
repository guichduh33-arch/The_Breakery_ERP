-- S20 Wave 2 + 2.5 - anon GRANT defense-in-depth regression suite.
--
-- A1 (Wave 2 / Phase 2.A):
--   zero anon GRANTs remain on public base tables OR views
--   (pgtap extension views pg_all_foreign_keys + tap_funky are excluded
--    as supabase_admin-owned platform objects outside migration scope)
--
-- A2 (Wave 2.5 / Phase 2.5.A):
--   zero anon EXECUTE remains on public functions
--   Placeholder pass until Phase 2.5.A migration applied; replaced inline.
--
-- S58 (Vague 0, T3) exception: `list_login_users_v1` is the FIRST legitimate
-- anon-callable function on this project — the pre-auth login user picker
-- has no PIN JWT yet, so it must query with the anon key. Named exclusion
-- (not a general allowlist) so the zero-tolerance check can't silently widen;
-- the companion suite `list_login_users.test.sql` positively asserts anon
-- CAN execute it and that its exposure stays minimal.
BEGIN;

SELECT plan(2);

-- A1 (Wave 2) : zero anon GRANTs remain on user-owned public base tables OR views
-- Excludes supabase_admin-owned pgtap extension views (platform-managed, out of scope).
SELECT is_empty(
  $$ SELECT t.table_name, i.table_type
       FROM information_schema.role_table_grants t
       JOIN information_schema.tables i
         ON t.table_schema = i.table_schema AND t.table_name = i.table_name
       JOIN pg_class c
         ON c.relname = t.table_name
       JOIN pg_namespace n
         ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_roles ro
         ON ro.oid = c.relowner
      WHERE t.grantee = 'anon'
        AND t.table_schema = 'public'
        AND i.table_type IN ('BASE TABLE', 'VIEW')
        AND ro.rolname != 'supabase_admin' $$,
  'no anon table/view GRANTs remain on postgres-owned public.*'
);

-- A2 (Wave 2.5) : zero anon EXECUTE remains on postgres-owned public functions.
-- Excludes supabase_admin-owned pgtap extension functions (DEV-S20-2.A-01 carryover).
SELECT is_empty(
  $$ SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       JOIN pg_roles ro ON ro.oid = p.proowner
      WHERE n.nspname = 'public'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')
        AND ro.rolname != 'supabase_admin'
        AND p.proname != 'list_login_users_v1' $$,
  'no anon function EXECUTE remains on postgres-owned public.* (except list_login_users_v1, S58 pre-auth login picker — see list_login_users.test.sql)'
);

SELECT * FROM finish();
ROLLBACK;
