BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE invoice_template_tap(seq serial,tap text);
CREATE TEMP TABLE invoice_template_actors AS SELECT gen_random_uuid() id,gen_random_uuid() auth_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('ADMIN'),('CASHIER')) r(role_code);
INSERT INTO auth.users(id,email) SELECT auth_id,auth_id||'@invoice-template.invalid' FROM invoice_template_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_id,'IT-'||id,'Invoice template fixture','unused-fixture-hash',role_code,true FROM invoice_template_actors;
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT id,'settings.read',true,'Transactional template test' FROM invoice_template_actors WHERE role_code='ADMIN';
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT id,'settings.update',false,'Transactional template test' FROM invoice_template_actors WHERE role_code='ADMIN';

INSERT INTO invoice_template_tap(tap) SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.invoice_print_templates'::regclass),'template storage uses RLS');
INSERT INTO invoice_template_tap(tap) SELECT ok(NOT has_table_privilege('authenticated','public.invoice_print_templates','UPDATE'),'direct client writes denied');
INSERT INTO invoice_template_tap(tap) SELECT ok(NOT has_table_privilege('authenticated','public.invoice_print_templates','SELECT'),'direct client reads denied');
INSERT INTO invoice_template_tap(tap) SELECT ok(NOT has_function_privilege('anon','public.get_invoice_print_template_v1()','EXECUTE'),'anonymous template reads denied through PUBLIC too');
INSERT INTO invoice_template_tap(tap) SELECT ok(NOT has_function_privilege('anon','public.update_invoice_print_template_v1(jsonb,integer)','EXECUTE'),'anonymous template writes denied through PUBLIC too');
INSERT INTO invoice_template_tap(tap) SELECT ok(has_table_privilege('service_role','public.invoice_print_templates','SELECT'),'PDF service can read the saved template');

SELECT pg_temp.authenticate_pin((SELECT auth_id FROM invoice_template_actors WHERE role_code='SUPER_ADMIN'));
INSERT INTO invoice_template_tap(tap) SELECT lives_ok('SELECT public.get_invoice_print_template_v1()','Owner can read the template');
CREATE TEMP TABLE invoice_template_initial AS SELECT (public.get_invoice_print_template_v1()).*;
CREATE TEMP TABLE invoice_template_first AS SELECT (public.update_invoice_print_template_v1(
 jsonb_build_object('heading','TEST INVOICE','paper_width_mm',241.3,'paper_height_mm',139.7,
  'margin_left_mm',12,'margin_right_mm',12,'margin_top_mm',12,'margin_bottom_mm',12,
  'offset_x_mm',2,'offset_y_mm',-1,'show_logo',false,'density','compact'),
 (SELECT revision FROM invoice_template_initial))).*;
INSERT INTO invoice_template_tap(tap) SELECT is((SELECT paper_width_mm FROM invoice_template_first),241.3::numeric,'custom paper width is retained in millimetres');
INSERT INTO invoice_template_tap(tap) SELECT is((SELECT paper_height_mm FROM invoice_template_first),139.7::numeric,'custom paper height is retained in millimetres');
INSERT INTO invoice_template_tap(tap) SELECT is((SELECT offset_x_mm FROM invoice_template_first),2::numeric,'horizontal alignment is retained');
INSERT INTO invoice_template_tap(tap) SELECT is((SELECT offset_y_mm FROM invoice_template_first),-1::numeric,'vertical alignment is retained');
INSERT INTO invoice_template_tap(tap) SELECT is((SELECT revision FROM invoice_template_first),(SELECT revision+1 FROM invoice_template_initial),'saving increments the revision');
INSERT INTO invoice_template_tap(tap) SELECT ok(EXISTS(SELECT 1 FROM public.audit_logs WHERE action='settings.invoice_template.updated'
 AND actor_id=(SELECT id FROM invoice_template_actors WHERE role_code='SUPER_ADMIN')
 AND payload->'after'->>'heading'='TEST INVOICE' AND payload->'before' ? 'heading'),'audit contains the profile actor and before/after presentation');
INSERT INTO invoice_template_tap(tap) SELECT is((public.update_invoice_print_template_v1('{"heading":"TEST INVOICE"}',
 (SELECT revision FROM invoice_template_initial))).revision,(SELECT revision FROM invoice_template_first),'retrying the same change is a no-op');
INSERT INTO invoice_template_tap(tap) SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE action='settings.invoice_template.updated'
 AND actor_id=(SELECT id FROM invoice_template_actors WHERE role_code='SUPER_ADMIN')),1,'retry does not duplicate the audit');

INSERT INTO invoice_template_tap(tap) SELECT throws_ok(format('SELECT public.update_invoice_print_template_v1(''{"heading":"STALE"}'',%s)',
 (SELECT revision FROM invoice_template_initial)),'40001','invoice_template_changed_reload','stale edits cannot overwrite a newer template');
INSERT INTO invoice_template_tap(tap) SELECT throws_ok(format('SELECT public.update_invoice_print_template_v1(''{"total":0}'',%s)',
 (SELECT revision FROM invoice_template_first)),'22023','invalid_invoice_template_field: total','financial totals are not template settings');
INSERT INTO invoice_template_tap(tap) SELECT throws_ok(format('SELECT public.update_invoice_print_template_v1(''{"revision":900}'',%s)',
 (SELECT revision FROM invoice_template_first)),'22023','invalid_invoice_template_field: revision','clients cannot forge the revision');
INSERT INTO invoice_template_tap(tap) SELECT throws_ok(format('SELECT public.update_invoice_print_template_v1(''{"paper_width_mm":"241.3"}'',%s)',
 (SELECT revision FROM invoice_template_first)),'22023','invalid_invoice_template_field: paper_width_mm','numeric fields reject strings');
INSERT INTO invoice_template_tap(tap) SELECT throws_ok(format('SELECT public.update_invoice_print_template_v1(''{"show_logo":null}'',%s)',
 (SELECT revision FROM invoice_template_first)),'22023','invalid_invoice_template_field: show_logo','null booleans are refused');
INSERT INTO invoice_template_tap(tap) SELECT throws_ok(format('SELECT public.update_invoice_print_template_v1(''{"paper_width_mm":1}'',%s)',
 (SELECT revision FROM invoice_template_first)),'23514',NULL,'invalid paper dimensions are refused');
INSERT INTO invoice_template_tap(tap) SELECT throws_ok(format('SELECT public.update_invoice_print_template_v1(''{"offset_x_mm":20,"margin_right_mm":0}'',%s)',
 (SELECT revision FROM invoice_template_first)),'23514',NULL,'offsets cannot move print outside the page');

SELECT pg_temp.authenticate_pin((SELECT auth_id FROM invoice_template_actors WHERE role_code='ADMIN'));
INSERT INTO invoice_template_tap(tap) SELECT lives_ok('SELECT public.get_invoice_print_template_v1()','settings reader can view the template');
INSERT INTO invoice_template_tap(tap) SELECT throws_ok('SELECT public.update_invoice_print_template_v1(''{"heading":"DENIED"}'',1)',
 'P0003','permission_denied: settings.update','settings reader cannot edit');
UPDATE public.user_permission_overrides SET is_granted=true WHERE permission_code='settings.update'
 AND user_profile_id=(SELECT id FROM invoice_template_actors WHERE role_code='ADMIN');
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.authenticate_pin((SELECT auth_id FROM invoice_template_actors WHERE role_code='ADMIN'));
INSERT INTO invoice_template_tap(tap) SELECT lives_ok(format('SELECT public.update_invoice_print_template_v1(''{"heading":"ADMIN INVOICE"}'',%s)',
 (SELECT revision FROM invoice_template_first)),'authorized Admin can save the template');
SELECT pg_temp.authenticate_pin((SELECT auth_id FROM invoice_template_actors WHERE role_code='CASHIER'));
INSERT INTO invoice_template_tap(tap) SELECT throws_ok('SELECT public.get_invoice_print_template_v1()',
 'P0003','permission_denied: settings.read','cashier cannot read invoice configuration');
INSERT INTO invoice_template_tap(tap) SELECT throws_ok('SELECT public.update_invoice_print_template_v1(''{"heading":"CASHIER"}'',1)',
 'P0003','permission_denied: settings.update','cashier cannot change invoice configuration');
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
INSERT INTO invoice_template_tap(tap) SELECT throws_ok('SELECT public.get_invoice_print_template_v1()',
 'P0003','permission_denied: settings.read','an active PIN session is required');
SELECT tap FROM invoice_template_tap ORDER BY seq;
SELECT * FROM finish();
ROLLBACK;
