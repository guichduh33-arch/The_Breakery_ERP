BEGIN;
SELECT plan(8);
INSERT INTO audit_logs(action, entity_type, metadata, created_at)
SELECT 'test.reports_cursor_p1', 'reports_p1', '{}', now() FROM generate_series(1,55);
CREATE TEMP TABLE report_page_1 AS SELECT * FROM get_audit_logs_v4(p_action := 'test.reports_cursor_p1', p_limit := 50);
CREATE TEMP TABLE report_page_2 AS SELECT * FROM get_audit_logs_v4(
 p_action := 'test.reports_cursor_p1', p_limit := 50,
 p_cursor := (SELECT created_at::text || '|' || id::text FROM report_page_1 ORDER BY created_at, id LIMIT 1));
SELECT is((SELECT count(*)::int FROM report_page_1),50,'première page complète');
SELECT is((SELECT count(*)::int FROM report_page_2),5,'les horodatages égaux ne sont pas perdus');
SELECT is((SELECT count(DISTINCT id)::int FROM (SELECT id FROM report_page_1 UNION ALL SELECT id FROM report_page_2) q),55,'aucun doublon');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_audit_logs_v4(text,integer,uuid,text,text,uuid,text,text)'::regprocedure),'audit conserve SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('anon','public.get_purchase_by_supplier_v2(text,text)','EXECUTE'),'fournisseurs interdit à anon');
DO $fixtures$
DECLARE v_supplier uuid; v_auth uuid;
BEGIN
 SELECT auth_user_id INTO STRICT v_auth FROM user_profiles
 WHERE deleted_at IS NULL AND has_permission(auth_user_id,'reports.inventory.read') LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',v_auth::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',v_auth)::text,true);
 INSERT INTO suppliers(code,name) VALUES ('T_REPORTS_P1','Reports P1') RETURNING id INTO v_supplier;
 INSERT INTO purchase_orders(po_number,supplier_id,status,order_date,received_date)
 VALUES ('T-REPORTS-P1-A',v_supplier,'received','1998-01-01','1998-01-03'),
        ('T-REPORTS-P1-B',v_supplier,'received','1998-01-01','1998-01-11'),
        ('T-REPORTS-P1-C',v_supplier,'cancelled','1998-01-01',NULL),
        ('T-REPORTS-P1-D',v_supplier,'pending','1998-01-01',NULL);
 PERFORM set_config('reports.p1_supplier',v_supplier::text,true);
END $fixtures$;
CREATE TEMP TABLE report_supplier_result AS
SELECT elem FROM jsonb_array_elements(get_purchase_by_supplier_v2('1998-01-01','1998-01-31')->'by_supplier') elem
WHERE elem->>'supplier_id'=current_setting('reports.p1_supplier');
SELECT is((SELECT (elem->>'lead_sample_count')::int FROM report_supplier_result),2,'seules les réceptions mesurées pèsent dans le délai');
SELECT is((SELECT (elem->>'lead_days_total')::numeric FROM report_supplier_result),12::numeric,'somme exacte des délais');
SELECT is(get_purchase_by_supplier_v2('1996-01-01','1998-01-31')->'period',
 jsonb_build_object('start',('1998-01-31'::date-366)::text,'end','1998-01-31'),'période effectivement servie après limitation');
SELECT * FROM finish();
ROLLBACK;
