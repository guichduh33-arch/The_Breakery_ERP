-- Aucune notification réelle envoyée ; données et changements annulés.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
CREATE TEMP TABLE notification_acl_results (line text);
GRANT INSERT ON notification_acl_results TO anon, authenticated, service_role;
INSERT INTO notification_acl_results SELECT plan(9);
INSERT INTO notification_acl_results SELECT ok(NOT has_function_privilege('anon', 'public.pick_notifications_batch_v2(integer)', 'EXECUTE'), 'anon denied');
INSERT INTO notification_acl_results SELECT ok(NOT has_function_privilege('authenticated', 'public.pick_notifications_batch_v2(integer)', 'EXECUTE'), 'authenticated denied');
INSERT INTO notification_acl_results SELECT ok(has_function_privilege('service_role', 'public.pick_notifications_batch_v2(integer)', 'EXECUTE'), 'service_role allowed');
INSERT INTO notification_acl_results SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a
  WHERE p.oid='public.pick_notifications_batch_v2(integer)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'
), 'PUBLIC has no EXECUTE');
INSERT INTO public.notification_templates(code,channel,body_template)
VALUES ('notification_acl_regression_fixture','email','Synthetic ACL test');
INSERT INTO public.notification_outbox(template_code,channel,recipient,body,scheduled_for)
VALUES ('notification_acl_regression_fixture','email','acl-test@example.invalid','Synthetic ACL test','-infinity');
SET LOCAL ROLE anon;
INSERT INTO notification_acl_results SELECT throws_ok(
  'SELECT * FROM public.pick_notifications_batch_v2(1)', '42501',
  'permission denied for function pick_notifications_batch_v2', 'anonymous call refused');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO notification_acl_results SELECT throws_ok(
  'SELECT * FROM public.pick_notifications_batch_v2(1)', '42501',
  'permission denied for function pick_notifications_batch_v2', 'ordinary session call refused');
RESET ROLE;
INSERT INTO notification_acl_results SELECT is(
 (SELECT status FROM public.notification_outbox WHERE template_code='notification_acl_regression_fixture'),
 'queued', 'refused calls leave notification queued');
SET LOCAL ROLE service_role;
INSERT INTO notification_acl_results SELECT is(
 (SELECT count(*)::integer FROM public.pick_notifications_batch_v2(1) WHERE recipient='acl-test@example.invalid' AND status='sending'),
 1, 'server claims synthetic notification');
RESET ROLE;
INSERT INTO notification_acl_results SELECT is(
 (SELECT status FROM public.notification_outbox WHERE template_code='notification_acl_regression_fixture'),
 'sending', 'server claim persists inside transaction');
INSERT INTO notification_acl_results SELECT * FROM finish();
SELECT line FROM notification_acl_results;
ROLLBACK;
