BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
INSERT INTO roles(code,name,is_system) VALUES('TEST_EXP_TERM','Expense terms test',false);
INSERT INTO auth.users(id) VALUES('ec310000-0000-4000-8000-000000000001');
INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash)
 VALUES('ec310000-0000-4000-8000-000000000002','ec310000-0000-4000-8000-000000000001',
 'TEST_EXP_TERM','Expense terms test','TEST-EXP-TERM',true,crypt('654321',gen_salt('bf')));
SELECT set_config('request.jwt.claim.sub','ec310000-0000-4000-8000-000000000001',true);
SELECT throws_ok($$SELECT get_expense_terms_v1()$$,'42501','permission_denied','reader permission required');
SELECT throws_ok($$SELECT save_expense_term_v1('TEST_TERM','Test term',
 (SELECT id FROM expense_categories WHERE code='UTILITIES'))$$,'42501','permission_denied','manager permission required');
INSERT INTO role_permissions(role_code,permission_code) VALUES
 ('TEST_EXP_TERM','expenses.categories.manage'),('TEST_EXP_TERM','expenses.create'),('TEST_EXP_TERM','expenses.read');
SELECT lives_ok($$SELECT save_expense_term_v1('TEST_TERM','Unique test electricity',
 (SELECT id FROM expense_categories WHERE code='UTILITIES'),ARRAY['Test power bill','Test courant'])$$,'create standard term');
SELECT is((SELECT count(*)::int FROM expense_term_labels WHERE term_id=(SELECT id FROM expense_terms WHERE code='TEST_TERM')),3,'canonical name and aliases registered');
SELECT throws_ok($$SELECT save_expense_term_v1('TEST_DUPLICATE',' TEST   POWER BILL ',
 (SELECT id FROM expense_categories WHERE code='UTILITIES'))$$,'23505',NULL,'case and spaces cannot duplicate a synonym');
SELECT is((SELECT count(*)::int FROM expense_terms WHERE code='TEST_DUPLICATE'),0,'failed duplicate does not leave a term');
SELECT throws_ok($$SELECT save_expense_term_v1('TEST_DUPLICATE','Different name',
 (SELECT id FROM expense_categories WHERE code='RENT'),ARRAY['Unique test electricity'])$$,'23505',NULL,'alias cannot shadow a canonical name');
SELECT throws_ok($$SELECT save_expense_term_v1('TEST_INVALID','Invalid',gen_random_uuid())$$,
 '22023','expense_term_category_unavailable','unknown category rejected');
SELECT throws_ok($$SELECT save_expense_term_v1('TEST_INVALID','Invalid',
 (SELECT id FROM expense_categories WHERE code='UTILITIES'),ARRAY[NULL::text])$$,
 '22023','expense_term_invalid_alias','null aliases rejected');
SELECT lives_ok($$SELECT create_expense_v4((SELECT category_id FROM expense_terms WHERE code='TEST_TERM'),
 1000,'cash','CLIENT TEXT IGNORED',CURRENT_DATE,0,NULL,NULL,'ec310000-0000-4000-8000-000000000003',
 (SELECT id FROM expense_terms WHERE code='TEST_TERM'),' October bill ')$$,'create with canonical term and remarks');
SELECT is((SELECT description FROM expenses WHERE idempotency_key='ec310000-0000-4000-8000-000000000003'),
 'Unique test electricity','server ignores free text');
SELECT is((SELECT remarks FROM expenses WHERE idempotency_key='ec310000-0000-4000-8000-000000000003'),
 'October bill','remarks trimmed and stored');
SELECT is((SELECT actor_id FROM audit_logs WHERE action='expense.create' AND entity_id=
 (SELECT id FROM expenses WHERE idempotency_key='ec310000-0000-4000-8000-000000000003')),
 'ec310000-0000-4000-8000-000000000002'::uuid,'audit references profile');
SELECT throws_ok($$SELECT create_expense_v4((SELECT id FROM expense_categories WHERE code='RENT'),
 1000,'cash','Mismatch',CURRENT_DATE,0,NULL,NULL,gen_random_uuid(),
 (SELECT id FROM expense_terms WHERE code='TEST_TERM'))$$,'22023','expense_term_category_mismatch','category mismatch rejected');
SELECT throws_ok($$SELECT create_expense_v4((SELECT id FROM expense_categories WHERE code='UTILITIES'),
 1000,'cash','Free text',CURRENT_DATE)$$,'22023','expense_term_required','term required for new creation');
SELECT throws_ok($$SELECT create_expense_v4((SELECT id FROM expense_categories WHERE code='UTILITIES'),
 1000,'cash','Too long',CURRENT_DATE,0,NULL,NULL,gen_random_uuid(),
 (SELECT id FROM expense_terms WHERE code='TEST_TERM'),repeat('x',2001))$$,
 '22023','expense_remarks_too_long','remarks length validated by RPC');
SELECT throws_ok($$SELECT save_expense_term_v1('TEST_TERM','Renamed',
 (SELECT category_id FROM expense_terms WHERE code='TEST_TERM'),ARRAY[]::text[],true,
 (SELECT id FROM expense_terms WHERE code='TEST_TERM'))$$,'22023','expense_term_in_use','used name locked');
SELECT throws_ok($$SELECT save_expense_term_v1('TEST_TERM','Unique test electricity',
 (SELECT id FROM expense_categories WHERE code='RENT'),ARRAY[]::text[],true,
 (SELECT id FROM expense_terms WHERE code='TEST_TERM'))$$,'22023','expense_term_in_use','used category locked');
SELECT lives_ok($$UPDATE expenses SET description='Another free name' WHERE
 idempotency_key='ec310000-0000-4000-8000-000000000003'$$,'direct update canonicalized');
SELECT is((SELECT description FROM expenses WHERE idempotency_key='ec310000-0000-4000-8000-000000000003'),
 'Unique test electricity','direct update cannot introduce synonym as description');
SELECT throws_ok($$UPDATE expenses SET expense_term_id=NULL WHERE
 idempotency_key='ec310000-0000-4000-8000-000000000003'$$,'22023','expense_term_required','assigned term cannot be removed');
SELECT lives_ok($$SELECT save_expense_term_v1('TEST_TERM','Unique test electricity',
 (SELECT category_id FROM expense_terms WHERE code='TEST_TERM'),ARRAY['Test power bill'],false,
 (SELECT id FROM expense_terms WHERE code='TEST_TERM'))$$,'deactivate used term');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(get_expense_terms_v1()) t
 WHERE t->>'code'='TEST_TERM'),0,'inactive hidden from new entry');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(get_expense_terms_v1(true)) t
 WHERE t->>'code'='TEST_TERM'),1,'inactive visible to management');
SELECT lives_ok($$SELECT create_expense_v4((SELECT category_id FROM expense_terms WHERE code='TEST_TERM'),
 1000,'cash','Legacy pending payload',CURRENT_DATE,0,NULL,NULL,'ec310000-0000-4000-8000-000000000003')$$,
 'idempotent replay survives deactivation and old payload without term');
SELECT is((SELECT count(*)::int FROM expenses WHERE idempotency_key='ec310000-0000-4000-8000-000000000003'),1,'replay creates no duplicate');
SELECT lives_ok($$UPDATE expenses SET remarks='Additional detail' WHERE
 idempotency_key='ec310000-0000-4000-8000-000000000003'$$,'inactive term permits unrelated detail update');
SELECT throws_ok($$SELECT create_expense_v4((SELECT category_id FROM expense_terms WHERE code='TEST_TERM'),
 1000,'cash','Inactive',CURRENT_DATE,0,NULL,NULL,gen_random_uuid(),
 (SELECT id FROM expense_terms WHERE code='TEST_TERM'))$$,'22023','expense_term_required','inactive rejected for new creation');
SELECT lives_ok($$INSERT INTO expenses(expense_number,category_id,amount,payment_method,description,expense_date,is_historical_import)
 VALUES('TEST-TERM-HISTORICAL',(SELECT id FROM expense_categories WHERE code='UTILITIES'),1000,'cash','Original historical text',CURRENT_DATE,true)$$,
 'historical imports retain their original text');
SELECT is((SELECT description FROM expenses WHERE expense_number='TEST-TERM-HISTORICAL'),'Original historical text','no historical rewrite');
SELECT ok(NOT has_table_privilege('authenticated','public.expense_terms','INSERT'),'no direct term creation');
SELECT ok(NOT has_table_privilege('anon','public.expense_terms','SELECT'),'no anonymous table access');
SELECT ok(NOT has_function_privilege('anon','public.get_expense_terms_v1(boolean)','EXECUTE'),'no anonymous term read RPC');
SELECT ok(NOT has_function_privilege('anon','public.save_expense_term_v1(text,text,uuid,text[],boolean,uuid)','EXECUTE'),'no anonymous term write RPC');
SELECT ok(NOT has_function_privilege('anon','public.create_expense_v4(uuid,numeric,text,text,date,numeric,text,text,uuid,uuid,text)','EXECUTE'),'no anonymous creation RPC');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.expense_terms'::regclass),'terms protected by RLS');
SELECT ok(to_regprocedure('public.create_expense_v3(uuid,numeric,text,text,date,numeric,text,text,uuid)') IS NULL,'old RPC removed');
SELECT * FROM finish();
ROLLBACK;
