-- Régression du lot dev : droits privés et défense PIN des quatre tables.
BEGIN;
SET LOCAL search_path=pg_catalog,public,extensions;
SELECT plan(12);
CREATE TEMP TABLE pin_policy_tables AS
 SELECT c.oid,c.relname,c.relrowsecurity FROM pg_class c
 WHERE c.oid IN ('public.business_day_releases'::regclass,
 'public.business_day_visibility_config'::regclass,
 'public.pos_payment_attempt_keys'::regclass,'public.stock_declarations'::regclass);
SELECT ok(relrowsecurity,'RLS: '||relname) FROM pin_policy_tables ORDER BY relname;
SELECT ok(EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=t.oid
 AND p.polname='pin_session_required' AND NOT p.polpermissive
 AND p.polcmd='*' AND p.polroles=ARRAY['authenticated'::regrole::oid]
 AND pg_get_expr(p.polqual,p.polrelid) LIKE '%request_has_active_pin_session_v1%'
 AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%request_has_active_pin_session_v1%'),
 'Restrictive PIN gate: '||relname) FROM pin_policy_tables t ORDER BY relname;
SELECT ok(NOT has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE'),
 'No direct client access: '||relname) FROM pin_policy_tables ORDER BY relname;
SELECT * FROM finish();
ROLLBACK;
