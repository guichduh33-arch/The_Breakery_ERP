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
-- La garde pre-request est également exécutable par anon, avec signature exacte :
-- elle reste neutre pour les parcours publics et ne retourne aucune donnée.
BEGIN;

SELECT plan(9);

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
        AND p.proname != 'list_login_users_v1'
        AND p.oid != 'public.enforce_pin_session_v2()'::regprocedure $$,
  'no unexpected anon function EXECUTE remains (login picker and exact pre-request guard only)'
);

SELECT ok(obj_description('public.enforce_pin_session_v2()'::regprocedure, 'pg_proc') LIKE
  'anon-callable:%', 'la garde porte la justification publique obligatoire');
SELECT ok(to_regprocedure('public.enforce_pin_session_v1()') IS NULL, 'ancienne garde retirée');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.enforce_pin_session_v2()'::regprocedure),
  'la garde conserve le rôle appelant');
SET LOCAL ROLE anon;
SELECT lives_ok('SELECT public.enforce_pin_session_v2()', 'pre-request anon neutre sans session PIN');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT public.enforce_pin_session_v2()', 'PT401', 'session_expired',
  'authenticated sans session reste refusé');
RESET ROLE;
SET LOCAL ROLE kiosk_display;
SELECT lives_ok('SELECT public.enforce_pin_session_v2()', 'appareil conserve ses propres gates');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok('SELECT public.enforce_pin_session_v2()', 'serveur conserve ses propres gates');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
