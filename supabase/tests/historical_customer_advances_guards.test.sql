BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
\ir helpers/historical_customer_advances_fixture.sql
\ir helpers/historical_customer_advances.sql
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(payload-'allow_customer_advances')->'errors' @> '[{"code":"customer_advance_not_enabled"}]','batch opt-in required') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(payload #- '{payments,0,customer_advance}')->'errors' @> '[{"code":"payment_precedes_document"}]','payment opt-in required') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(jsonb_set(payload,'{payments,0,customer_advance}','"true"'))->'errors' @> '[{"code":"payment_precedes_document"}]','string true is not an opt-in') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(jsonb_set(payload,'{documents,0,customer_treatment}','"retail"'))->'errors' @> '[{"code":"customer_advance_customer_mismatch"}]','retail advance refused') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(jsonb_set(payload,'{payments,0,customer_id}',to_jsonb(customer)))->'errors' @> '[{"code":"customer_advance_customer_mismatch"}]','wrong customer refused') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(payload #- '{payments,0,customer_id}')->'errors' @> '[{"code":"customer_advance_customer_mismatch"}]','customer identity required') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(payload #- '{payments,0,allocations,0,application_date}')->'errors' @> '[{"code":"customer_advance_application_date_invalid"}]','application date required') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(jsonb_set(payload,'{payments,0,allocations,0,application_date}','"2097-01-25"'))->'errors' @> '[{"code":"customer_advance_application_date_invalid"}]','application before invoice refused') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(jsonb_set(payload,'{payments,0,amount}','100001'))->'errors' @> '[{"code":"allocation_total_mismatch"}]','unallocated remainder refused') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(NOT has_function_privilege('anon','preview_historical_import_v4(jsonb)','EXECUTE'),'anon cannot preview');
INSERT INTO historical_tap(result) SELECT ok(NOT has_function_privilege('anon','apply_historical_import_v4(jsonb,text,uuid)','EXECUTE'),'anon cannot apply');
INSERT INTO historical_tap(result) SELECT ok(NOT has_function_privilege('authenticated','_historical_import_payment_v2(uuid,jsonb,jsonb)','EXECUTE'),'payment helper remains private');
UPDATE fiscal_periods SET status='closed' WHERE period_start=date '2097-01-01';
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v4(payload)->'errors' @> '[{"code":"customer_advance_application_period_closed"}]','closed application period refused') FROM historical_fixture;
SELECT jsonb_build_object('executed',(SELECT count(*) FROM historical_tap),
 'failures',(SELECT coalesce(jsonb_agg(result),'[]') FROM historical_tap WHERE result LIKE 'not ok%'),
 'tap_finish',(SELECT coalesce(jsonb_agg(result),'[]') FROM finish() result)) AS test_result;
ROLLBACK;
