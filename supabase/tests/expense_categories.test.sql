-- Contrat catégories, préparé localement ; exécution dev autorisée séparément.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO roles(code, name, is_system) VALUES ('TEST_EXP_CAT', 'Expense categories test', false);
INSERT INTO auth.users(id) VALUES ('ec300000-0000-0000-0000-000000000001');
INSERT INTO user_profiles(id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash)
VALUES ('ec300000-0000-0000-0000-000000000002', 'ec300000-0000-0000-0000-000000000001',
  'TEST_EXP_CAT', 'Expense categories test', 'TEST-EXP-CAT-3009', true, crypt('654321', gen_salt('bf')));
SELECT set_config('request.jwt.claim.sub', 'ec300000-0000-0000-0000-000000000001', true);

CREATE TEMP TABLE cat_fixture AS
SELECT array_agg(id ORDER BY code) AS accounts FROM accounts
WHERE account_class = 6 AND is_active AND is_postable AND deleted_at IS NULL;
SELECT ok(cardinality(accounts) >= 2, 'fixture: two eligible expense accounts') FROM cat_fixture;

SELECT throws_ok($$SELECT create_expense_category_v1('TEST_CAT_3009', 'Test',
  (SELECT accounts[1] FROM cat_fixture))$$, '42501', 'permission denied', 'dedicated permission required');
INSERT INTO role_permissions(role_code, permission_code) VALUES
 ('TEST_EXP_CAT', 'expenses.categories.manage'), ('TEST_EXP_CAT', 'expenses.create'),
 ('TEST_EXP_CAT', 'expenses.read');

SELECT lives_ok($$SELECT create_expense_category_v1('TEST_CAT_3009', 'Test',
  (SELECT accounts[1] FROM cat_fixture), 'Description')$$, 'create category');
SELECT is((SELECT description FROM expense_categories WHERE code='TEST_CAT_3009'), 'Description', 'description persisted');
SELECT is((SELECT actor_id FROM audit_logs WHERE action='expense_category.created'
  AND entity_id=(SELECT id FROM expense_categories WHERE code='TEST_CAT_3009')),
  'ec300000-0000-0000-0000-000000000002'::uuid, 'audit actor is profile, not auth id');
SELECT throws_ok($$SELECT create_expense_category_v1('TEST_CAT_3009', 'Duplicate',
  (SELECT accounts[1] FROM cat_fixture))$$, '23505', NULL, 'duplicate code rejected');
SELECT throws_ok($$SELECT create_expense_category_v1('TEST_BAD_3009', 'Invalid account',
  (SELECT id FROM accounts WHERE account_class <> 6 LIMIT 1))$$,
  '22023', 'expense_category_account_invalid', 'non-expense account rejected');
SELECT throws_ok($$UPDATE expense_categories SET code='RENAME' WHERE code='TEST_CAT_3009'$$,
  '22023', 'expense_category_code_immutable', 'code immutable even below RPC');
SELECT lives_ok($$SELECT update_expense_category_v1((SELECT id FROM expense_categories WHERE code='TEST_CAT_3009'),
  'Renamed', (SELECT accounts[2] FROM cat_fixture), 'Updated', true)$$, 'unused account editable');

SELECT lives_ok($$SELECT create_expense_v2((SELECT id FROM expense_categories WHERE code='TEST_CAT_3009'),
  5000, 'cash', 'Category fixture', CURRENT_DATE, 0, NULL, NULL,
  'ec300000-0000-0000-0000-000000000003')$$, 'create draft with active category');
SELECT throws_ok($$SELECT update_expense_category_v1((SELECT id FROM expense_categories WHERE code='TEST_CAT_3009'),
  'Renamed', (SELECT accounts[1] FROM cat_fixture), 'Updated', true)$$,
  '22023', 'expense_category_account_in_use', 'draft locks account');
UPDATE expenses SET deleted_at=now() WHERE idempotency_key='ec300000-0000-0000-0000-000000000003';
SELECT throws_ok($$SELECT update_expense_category_v1((SELECT id FROM expense_categories WHERE code='TEST_CAT_3009'),
  'Renamed', (SELECT accounts[1] FROM cat_fixture), 'Updated', true)$$,
  '22023', 'expense_category_account_in_use', 'soft-deleted expense also locks account');
UPDATE expenses SET deleted_at=NULL WHERE idempotency_key='ec300000-0000-0000-0000-000000000003';
SELECT lives_ok($$SELECT update_expense_category_v1((SELECT id FROM expense_categories WHERE code='TEST_CAT_3009'),
  'Renamed', (SELECT accounts[2] FROM cat_fixture), 'Updated again', false)$$, 'used category may be renamed and disabled');
SELECT throws_ok($$SELECT create_expense_v2((SELECT id FROM expense_categories WHERE code='TEST_CAT_3009'),
  5000, 'cash', 'Blocked', CURRENT_DATE)$$,
  '22023', 'expense_category_inactive', 'new RPC expense cannot use inactive category');
SELECT lives_ok($$SELECT create_expense_v2((SELECT id FROM expense_categories WHERE code='TEST_CAT_3009'),
  5000, 'cash', 'Category fixture', CURRENT_DATE, 0, NULL, NULL,
  'ec300000-0000-0000-0000-000000000003')$$, 'replay of existing expense survives deactivation');
SELECT lives_ok($$UPDATE expenses SET description='Existing expense continues', category_id=category_id
  WHERE idempotency_key='ec300000-0000-0000-0000-000000000003'$$,
  'unchanged category does not block existing expense');
SELECT lives_ok($$SELECT create_expense_category_v1('TEST_OTHER_3009', 'Other',
  (SELECT accounts[1] FROM cat_fixture))$$, 'second active category');
SELECT create_expense_v2((SELECT id FROM expense_categories WHERE code='TEST_OTHER_3009'),
  5000, 'cash', 'Other fixture', CURRENT_DATE, 0, NULL, NULL,
  'ec300000-0000-0000-0000-000000000004');
SELECT throws_ok($$UPDATE expenses SET category_id=(SELECT id FROM expense_categories WHERE code='TEST_CAT_3009')
  WHERE idempotency_key='ec300000-0000-0000-0000-000000000004'$$,
  '22023', 'expense_category_inactive', 'direct reassignment cannot bypass inactive gate');

SELECT is((import_expenses_v3(jsonb_build_array(jsonb_build_object(
  'expense_date', CURRENT_DATE, 'category', 'TEST_CAT_3009', 'description', 'Import', 'amount', 5000)), true)
  ->>'valid')::boolean, false, 'import dry-run rejects inactive category');
SELECT is((import_expenses_v3(jsonb_build_array(jsonb_build_object(
  'expense_date', CURRENT_DATE, 'category', 'TEST_CAT_3009', 'description', 'Import', 'amount', 5000)), true)
  #>>'{errors,0,code}'), 'inactive_category', 'import supplies line-level diagnostic');
SELECT is((import_expenses_v3(jsonb_build_array(jsonb_build_object(
  'expense_date', CURRENT_DATE, 'category', 'TEST_OTHER_3009', 'description', 'Import', 'amount', 5000)), false,
  'ec300000-0000-0000-0000-000000000005')->>'valid')::boolean, true, 'active category import succeeds');
SELECT update_expense_category_v1((SELECT id FROM expense_categories WHERE code='TEST_OTHER_3009'),
  'Other', (SELECT accounts[1] FROM cat_fixture), NULL, false);
SELECT is((import_expenses_v3('[]', false, 'ec300000-0000-0000-0000-000000000005')
  ->>'idempotent_replay')::boolean, true, 'import replay survives deactivation');
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(get_expense_categories_admin_v1()->'categories') c
  WHERE c->>'code'='TEST_CAT_3009' AND (c->>'is_used')::boolean AND NOT (c->>'is_active')::boolean),
  'management read includes inactive and usage flag');
SELECT ok(NOT has_function_privilege('anon', 'public.create_expense_category_v1(text,text,uuid,text,boolean)', 'EXECUTE'), 'anon create denied including PUBLIC');
SELECT ok(NOT has_function_privilege('anon', 'public.update_expense_category_v1(uuid,text,uuid,text,boolean)', 'EXECUTE'), 'anon update denied including PUBLIC');
SELECT ok(NOT has_function_privilege('anon', 'public.get_expense_categories_admin_v1()', 'EXECUTE'), 'anon read denied including PUBLIC');
SELECT ok(NOT has_function_privilege('authenticated', 'public.guard_expense_category_assignment()', 'EXECUTE'), 'internal trigger not directly callable');
SELECT ok(to_regprocedure('public.import_expenses_v2(jsonb,boolean,uuid)') IS NULL, 'old import signature removed');
SELECT * FROM finish();
ROLLBACK;
