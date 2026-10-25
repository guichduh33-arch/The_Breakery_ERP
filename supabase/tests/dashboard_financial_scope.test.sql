-- Autorisations financières et bornes MTD, toutes les fixtures sous rollback.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE rf_actors(kind text PRIMARY KEY, auth_id uuid, profile_id uuid);
INSERT INTO rf_actors SELECT k, gen_random_uuid(), gen_random_uuid()
FROM unnest(ARRAY['commercial','financial','denied']) k;
INSERT INTO auth.users(id) SELECT auth_id FROM rf_actors;
INSERT INTO public.user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
SELECT profile_id,auth_id,'CASHIER','RF-'||left(profile_id::text,8),'Report scope fixture',hash_pin('285741'),true
FROM rf_actors;
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason,granted_by)
SELECT a.profile_id,p.code,CASE p.code
 WHEN 'reports.read' THEN a.kind <> 'denied'
 WHEN 'reports.financial.read' THEN a.kind <> 'commercial'
 ELSE a.kind = 'commercial' END,
 'Transactional financial report fixture',a.profile_id
FROM rf_actors a CROSS JOIN unnest(ARRAY['reports.read','reports.financial.read','accounting.cash.read']) p(code);
CREATE TEMP TABLE rf_results(kind text PRIMARY KEY, result jsonb);
GRANT SELECT ON rf_actors TO authenticated;
GRANT INSERT,SELECT ON rf_results TO authenticated;

DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM rf_actors WHERE kind='commercial')); END $$;
SET LOCAL ROLE authenticated;
SELECT ok(public.request_has_active_pin_session_v1(),'commercial actor has a real active PIN session');
INSERT INTO rf_results VALUES('commercial', public.get_dashboard_overview_v4());
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM rf_actors WHERE kind='financial')); END $$;
SET LOCAL ROLE authenticated;
SELECT ok(public.request_has_active_pin_session_v1(),'financial actor has a real active PIN session');
INSERT INTO rf_results VALUES('financial', public.get_dashboard_overview_v4());
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM rf_actors WHERE kind='denied')); END $$;
SET LOCAL ROLE authenticated;
SELECT ok(public.request_has_active_pin_session_v1(),'denied actor is authenticated, permission is the gate');
SELECT throws_ok('SELECT public.get_dashboard_overview_v4()', '42501',
 'permission denied: reports.read required','reports.read still required even with financial permission');
RESET ROLE;

SELECT is(result->'kpis'->'gross_margin',
 '{"restricted":true,"value":null,"vs_yesterday_pt":null,"vs_d7_pt":null,"basis":null,"cost_coverage_pct":null}'::jsonb,
 'commercial response removes every margin value, comparison and cost basis')
FROM rf_results WHERE kind='commercial';
SELECT is(result->'cost_mtd',
 '{"restricted":true,"cogs_total":null,"opex_total":null,"sales_mtd":null,"cogs_pct_of_sales":null,"opex_pct_of_sales":null,"total":null,"cost_per_basket":null,"lines":[]}'::jsonb,
 'commercial response removes totals, denominators and account details')
FROM rf_results WHERE kind='commercial';
SELECT is((SELECT result-'kpis'-'cost_mtd' FROM rf_results WHERE kind='commercial'),
 (SELECT result-'kpis'-'cost_mtd' FROM rf_results WHERE kind='financial'),
 'commercial series and payment blocks are unchanged between financial roles');
SELECT is((SELECT (result->'kpis')-'gross_margin'-'cash_on_hand' FROM rf_results WHERE kind='commercial'),
 (SELECT (result->'kpis')-'gross_margin'-'cash_on_hand' FROM rf_results WHERE kind='financial'),
 'commercial KPI values and comparisons remain available');
SELECT ok(NOT COALESCE((result->'kpis'->'cash_on_hand'->>'restricted')::boolean,false),
 'cash permission remains independently granted') FROM rf_results WHERE kind='commercial';
SELECT is(result->'kpis'->'cash_on_hand',
 '{"value":null,"restricted":true,"wallets":[]}'::jsonb,
 'financial permission does not grant cash access') FROM rf_results WHERE kind='financial';
SELECT is(result->'cost_mtd', public._dashboard_cost_mtd_v2(
 COALESCE((SELECT MAX(timezone) FROM business_config WHERE id=1),'Asia/Makassar'),
 (now() AT TIME ZONE COALESCE((SELECT MAX(timezone) FROM business_config WHERE id=1),'Asia/Makassar'))::date),
 'financial reader receives the exact cost helper result') FROM rf_results WHERE kind='financial';
SELECT is(result->'kpis'->'gross_margin', public._dashboard_kpis_v2(
 COALESCE((SELECT MAX(timezone) FROM business_config WHERE id=1),'Asia/Makassar'),
 (now() AT TIME ZONE COALESCE((SELECT MAX(timezone) FROM business_config WHERE id=1),'Asia/Makassar'))::date)->'gross_margin',
 'financial reader retains complete margin values and comparisons') FROM rf_results WHERE kind='financial';

SELECT ok(to_regprocedure('public.get_dashboard_overview_v3()') IS NULL
 AND to_regprocedure('public._dashboard_cost_mtd_v1(text,date)') IS NULL,'old versions removed atomically');
SELECT ok(has_function_privilege('authenticated','public.get_dashboard_overview_v4()','EXECUTE')
 AND has_function_privilege('service_role','public.get_dashboard_overview_v4()','EXECUTE')
 AND NOT has_function_privilege('anon','public.get_dashboard_overview_v4()','EXECUTE'),
 'overview keeps its exact client/server grants');
SELECT ok(NOT has_function_privilege('authenticated','public._dashboard_cost_mtd_v2(text,date)','EXECUTE')
 AND NOT has_function_privilege('anon','public._dashboard_cost_mtd_v2(text,date)','EXECUTE')
 AND has_function_privilege('service_role','public._dashboard_cost_mtd_v2(text,date)','EXECUTE'),
 'cost helper remains private to the server');
SELECT ok(NOT EXISTS(
 SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid IN ('public.get_dashboard_overview_v4()'::regprocedure,
   'public._dashboard_cost_mtd_v2(text,date)'::regprocedure) AND a.grantee=0 AND a.privilege_type='EXECUTE'),
 'PUBLIC has no inherited execution path');

-- MTD déterministe, sans dépendre du calendrier d'exécution ni des données réelles.
DO $$
DECLARE v_shift uuid;
BEGIN
 INSERT INTO pos_sessions(opened_by,opening_cash,status)
 VALUES((SELECT profile_id FROM rf_actors WHERE kind='financial'),0,'closed') RETURNING id INTO v_shift;
 PERFORM set_config('rf.shift',v_shift::text,true);
END $$;
CREATE TEMP TABLE rf_mtd(kind text PRIMARY KEY,result jsonb);
INSERT INTO rf_mtd VALUES('baseline',public._dashboard_cost_mtd_v2('Asia/Makassar','2040-03-15'));
CREATE TEMP TABLE rf_accounts(kind text PRIMARY KEY,id uuid,code text);
INSERT INTO rf_accounts SELECT k,gen_random_uuid(),'RF-'||k||'-'||gen_random_uuid()
FROM unnest(ARRAY['cogs','opex','future','asset']) k;
INSERT INTO public.accounts(id,code,name,account_class,account_type,balance_type)
SELECT id,code,'Report fixture '||kind,
 CASE kind WHEN 'cogs' THEN 5 WHEN 'asset' THEN 1 ELSE 6 END,
 CASE kind WHEN 'asset' THEN 'asset' ELSE 'expense' END,'debit' FROM rf_accounts;

CREATE FUNCTION pg_temp.rf_post(p_kind text,p_date date,p_amount numeric,p_status text DEFAULT 'posted')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_je uuid;
BEGIN
 INSERT INTO public.journal_entries(entry_number,entry_date,status,total_debit,total_credit,created_by)
 VALUES('RF-'||gen_random_uuid(),p_date,p_status,p_amount,p_amount,
  (SELECT profile_id FROM rf_actors WHERE kind='financial')) RETURNING id INTO v_je;
 INSERT INTO public.journal_entry_lines(journal_entry_id,account_id,debit,credit)
 VALUES(v_je,(SELECT id FROM rf_accounts WHERE kind=p_kind),p_amount,0),
       (v_je,(SELECT id FROM rf_accounts WHERE kind='asset'),0,p_amount);
END $$;
SELECT pg_temp.rf_post('cogs','2040-03-01',40);
SELECT pg_temp.rf_post('cogs','2040-03-15',60);
SELECT pg_temp.rf_post('opex','2040-03-15',20);
SELECT pg_temp.rf_post('cogs','2040-02-01',100);
SELECT pg_temp.rf_post('cogs','2040-02-29',300);
INSERT INTO public.orders(order_number,order_type,status,subtotal,tax_amount,total,paid_at,session_id)
VALUES('RF-'||gen_random_uuid(),'take_out','completed',200,0,200,'2040-03-01 00:00:00+08',current_setting('rf.shift')::uuid),
      ('RF-'||gen_random_uuid(),'take_out','completed',300,0,300,'2040-03-15 23:59:59.999999+08',current_setting('rf.shift')::uuid);
INSERT INTO rf_mtd VALUES('current',public._dashboard_cost_mtd_v2('Asia/Makassar','2040-03-15'));
SELECT is((SELECT (result->>'cogs_total')::numeric FROM rf_mtd WHERE kind='current')
 -(SELECT (result->>'cogs_total')::numeric FROM rf_mtd WHERE kind='baseline'),100::numeric,'COGS includes month start and the whole current business day');
SELECT is((SELECT (result->>'opex_total')::numeric FROM rf_mtd WHERE kind='current')
 -(SELECT (result->>'opex_total')::numeric FROM rf_mtd WHERE kind='baseline'),20::numeric,'OpEx includes today');
SELECT is((SELECT (result->>'sales_mtd')::numeric FROM rf_mtd WHERE kind='current')
 -(SELECT (result->>'sales_mtd')::numeric FROM rf_mtd WHERE kind='baseline'),500::numeric,'sales denominator includes both business-day boundaries');
SELECT is((SELECT (line->>'mom_delta_pct')::numeric FROM rf_mtd r,
 LATERAL jsonb_array_elements(r.result->'lines') line
 WHERE r.kind='current' AND line->>'account_code'=(SELECT code FROM rf_accounts WHERE kind='cogs')),
 -75::numeric,'comparison keeps the complete previous month including February 29');

SELECT pg_temp.rf_post('cogs','2040-03-16',90000);
SELECT pg_temp.rf_post('future','2040-03-31',80000);
SELECT pg_temp.rf_post('opex','2040-04-01',70000);
SELECT pg_temp.rf_post('cogs','2040-01-31',60000);
SELECT pg_temp.rf_post('cogs','2040-03-15',50000,'draft');
INSERT INTO public.orders(order_number,order_type,status,subtotal,tax_amount,total,paid_at,session_id)
VALUES('RF-'||gen_random_uuid(),'take_out','completed',90000,0,90000,'2040-03-16 00:00:00+08',current_setting('rf.shift')::uuid),
      ('RF-'||gen_random_uuid(),'take_out','completed',80000,0,80000,'2040-04-01 00:00:00+08',current_setting('rf.shift')::uuid);
INSERT INTO rf_mtd VALUES('excluded',public._dashboard_cost_mtd_v2('Asia/Makassar','2040-03-15'));
SELECT is((SELECT result FROM rf_mtd WHERE kind='excluded'),(SELECT result FROM rf_mtd WHERE kind='current'),
 'future sales/entries, draft and older periods do not alter any MTD total, ratio, basket or account line');
SELECT * FROM finish();
ROLLBACK;
