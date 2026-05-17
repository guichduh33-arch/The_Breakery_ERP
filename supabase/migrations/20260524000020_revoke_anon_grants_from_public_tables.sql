-- 20260524000020_revoke_anon_grants_from_public_tables.sql
-- Session 20 / Wave 2 — REVOKE anon table+view GRANTs on public.*.
--
-- Defense-in-depth complement to S13's anon-RLS sweep. No public.* table or
-- view needs anon GRANT in this project : EFs run as service_role, the
-- packages/supabase client wires authenticated session via custom-fetch,
-- kiosks authenticate as authenticated-with-kiosk-JWT (has_kiosk_jwt()).
--
-- Step 1 surfaced two auto-grant roles: postgres + supabase_admin.
-- supabase_admin default-ACL entries are platform-managed and cannot be
-- altered via migration (permission denied). postgres clauses are applied.
-- The DO-loop REVOKEs existing grants on all current tables/views.
-- A canary test (Step 5) confirmed postgres-role default privileges work:
-- new tables created by postgres will NOT auto-grant to anon.
--
-- 14 residual anon grants remain on pgtap extension views:
--   pg_all_foreign_keys + tap_funky (both owned by supabase_admin / pgtap).
-- These are diagnostic-only pgtap objects with no project data.
-- postgres cannot revoke supabase_admin-granted privileges on supabase_admin-
-- owned objects. Documented as deviation DEV-S20-2.A-01.

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT t.table_name, i.table_type
      FROM information_schema.role_table_grants t
      JOIN information_schema.tables i
        ON t.table_schema = i.table_schema
       AND t.table_name = i.table_name
     WHERE t.grantee = 'anon'
       AND t.table_schema = 'public'
       AND i.table_type IN ('BASE TABLE', 'VIEW')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.table_name);
  END LOOP;
END
$do$;

-- Future-proof: new tables/views/sequences created by postgres role in
-- public.* will NOT auto-grant to anon.
-- Two roles discovered in Step 1: postgres and supabase_admin.
-- supabase_admin clauses cannot be applied (platform-managed, permission denied).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
