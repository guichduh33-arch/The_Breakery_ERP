-- La garde PIN n'ouvre aucun accès direct aux tables antifraude.
BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;
SELECT plan(9);
CREATE TEMP TABLE antifraud_policy_results(seq serial,tap text);
INSERT INTO antifraud_policy_results(tap) SELECT ok(c.relrowsecurity,'RLS enabled: '||c.relname)
 FROM pg_class c WHERE c.oid IN('public.stock_declarations'::regclass,
 'public.business_day_visibility_config'::regclass,'public.business_day_releases'::regclass)
 ORDER BY c.relname;
INSERT INTO antifraud_policy_results(tap) SELECT ok(EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
 AND p.polname='pin_session_required' AND NOT p.polpermissive
 AND p.polcmd='*' AND p.polroles=ARRAY['authenticated'::regrole::oid]
 AND pg_get_expr(p.polqual,p.polrelid) LIKE '%request_has_active_pin_session_v1%'
 AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%request_has_active_pin_session_v1%'),
 'Restrictive PIN policy: '||c.relname)
 FROM pg_class c WHERE c.oid IN('public.stock_declarations'::regclass,
 'public.business_day_visibility_config'::regclass,'public.business_day_releases'::regclass)
 ORDER BY c.relname;
INSERT INTO antifraud_policy_results(tap) SELECT ok(NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
 'No direct client access: '||c.relname)
 FROM pg_class c WHERE c.oid IN('public.stock_declarations'::regclass,
 'public.business_day_visibility_config'::regclass,'public.business_day_releases'::regclass)
 ORDER BY c.relname;
INSERT INTO antifraud_policy_results(tap) SELECT * FROM finish();
SELECT count(*) FILTER(WHERE tap LIKE 'not ok%') failures,
 jsonb_agg(tap ORDER BY seq) lines FROM antifraud_policy_results;
ROLLBACK;
