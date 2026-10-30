-- Méthode comptabilisée figée ; règlement des crédits cohérent, sous rollback.
BEGIN;
\ir helpers/expense_terms.sql
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE ep_actor(auth_id uuid,profile_id uuid);
INSERT INTO ep_actor VALUES(gen_random_uuid(),gen_random_uuid());
INSERT INTO auth.users(id) SELECT auth_id FROM ep_actor;
INSERT INTO user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
SELECT profile_id,auth_id,'CASHIER','EPM-'||left(profile_id::text,8),'Expense method fixture',hash_pin('285741'),true FROM ep_actor;
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT profile_id,'expenses.pay',true,'Transactional expense method fixture' FROM ep_actor;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM ep_actor)); END $$;
CREATE TEMP TABLE ep_category(id uuid);
WITH a AS (
 INSERT INTO accounts(code,name,account_class,account_type,balance_type)
 VALUES('EPM-'||gen_random_uuid(),'Expense method charge fixture',6,'expense','debit') RETURNING id
), c AS (
 INSERT INTO expense_categories(code,name,account_id)
 SELECT 'EPM-'||gen_random_uuid(),'Expense method fixture',id FROM a RETURNING id
) INSERT INTO ep_category SELECT id FROM c;
CREATE TEMP TABLE ep_cases(kind text PRIMARY KEY,id uuid,method text,je_id uuid,lines jsonb);
CREATE FUNCTION pg_temp.ep_make(p_kind text,p_method text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;v_je uuid;
BEGIN
 INSERT INTO expenses(expense_number,description,amount,expense_date,category_id,payment_method,status,created_by,vat_amount, expense_term_id)
 VALUES('EPM-'||gen_random_uuid(),'Expense method fixture',110000,CURRENT_DATE,
  (SELECT id FROM ep_category),p_method,'approved',(SELECT profile_id FROM ep_actor),10000, pg_temp.expense_term_fixture((SELECT id FROM ep_category), 'Expense method fixture')) RETURNING id INTO v_id;
 v_je:=public._emit_expense_je(v_id);
 INSERT INTO ep_cases VALUES(p_kind,v_id,p_method,v_je,
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM journal_entry_lines l WHERE journal_entry_id=v_je));
END $$;
SELECT pg_temp.ep_make('cash','cash');
SELECT pg_temp.ep_make('cash-same','cash');
SELECT pg_temp.ep_make('transfer','transfer');
SELECT pg_temp.ep_make('card','card');
SELECT pg_temp.ep_make('credit-cash','credit');
SELECT pg_temp.ep_make('credit-transfer','credit');
SELECT pg_temp.ep_make('credit-card','credit');
SELECT pg_temp.ep_make('credit-default','credit');
SELECT pg_temp.ep_make('credit-invalid','credit');
GRANT SELECT ON ep_cases TO authenticated;
SET LOCAL ROLE authenticated;
SELECT ok(public.request_has_active_pin_session_v1(),'caller uses a real active PIN session');
SELECT throws_ok(format('SELECT public.pay_expense_v4(%L::uuid,%L)',id,
 CASE method WHEN 'cash' THEN 'transfer' ELSE 'cash' END),
 '22023','payment_method_locked','non-credit method cannot change: '||kind)
FROM ep_cases WHERE method <> 'credit';
RESET ROLE;
SELECT is(e.status,'approved','rejected change leaves approval intact: '||c.kind)
 FROM ep_cases c JOIN expenses e USING(id) WHERE c.method <> 'credit';
SELECT is(e.payment_method,c.method,'rejected change preserves recorded method: '||c.kind)
 FROM ep_cases c JOIN expenses e USING(id) WHERE c.method <> 'credit';
SELECT is((SELECT count(*) FROM audit_logs WHERE entity_id IN (SELECT id FROM ep_cases)),0::bigint,
 'rejected changes leave no payment audit or partial write');
SET LOCAL ROLE authenticated;
SELECT lives_ok(format('SELECT public.pay_expense_v4(%L::uuid,NULL)',id),
 'omitted method marks non-credit expense paid: '||kind)
 FROM ep_cases WHERE method <> 'credit' AND kind <> 'cash-same';
SELECT lives_ok(format('SELECT public.pay_expense_v4(%L::uuid,%L)',id,'cash'),'explicit recorded method remains accepted') FROM ep_cases WHERE kind='cash-same';
SELECT lives_ok(format('SELECT public.pay_expense_v4(%L::uuid,%L)',id,replace(kind,'credit-','')),
 'credit settlement allowed: '||kind) FROM ep_cases WHERE kind IN ('credit-cash','credit-transfer','credit-card');
SELECT lives_ok(format('SELECT public.pay_expense_v4(%L::uuid)',id),'credit settlement default allowed')
 FROM ep_cases WHERE kind='credit-default';
SELECT throws_ok(format('SELECT public.pay_expense_v4(%L::uuid,%L)',id,'bitcoin'),'22023',
 'pay_expense_v4: unknown payment method bitcoin','unknown credit settlement still rejected')
 FROM ep_cases WHERE kind='credit-invalid';
RESET ROLE;

SELECT ok(e.status='paid' AND e.payment_method=c.method AND e.je_id=c.je_id AND e.payment_je_id IS NULL,
 'non-credit settlement keeps its original accounting identity: '||c.kind)
 FROM ep_cases c JOIN expenses e USING(id) WHERE c.method <> 'credit';
SELECT is((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM journal_entry_lines l WHERE journal_entry_id=c.je_id),
 c.lines,'approval journal remains byte-for-byte unchanged: '||c.kind)
 FROM ep_cases c WHERE c.method <> 'credit';
SELECT is((SELECT count(*) FROM journal_entries WHERE reference_id=c.id AND reference_type='expense_payment'),
 0::bigint,'non-credit settlement creates no second JE: '||c.kind)
 FROM ep_cases c WHERE c.method <> 'credit';
SELECT is(e.payment_method,CASE c.kind WHEN 'credit-default' THEN 'cash' ELSE replace(c.kind,'credit-','') END,
 'chosen/default method is persisted for credit: '||c.kind)
 FROM ep_cases c JOIN expenses e USING(id) WHERE c.kind LIKE 'credit-%' AND c.kind <> 'credit-invalid';
SELECT is((SELECT l.account_id FROM journal_entry_lines l WHERE l.journal_entry_id=e.payment_je_id AND l.credit>0),
 public.resolve_mapping_account(public._expense_settlement_mapping_key(e.payment_method)),
 'credit settlement account matches persisted method: '||c.kind)
 FROM ep_cases c JOIN expenses e USING(id) WHERE c.kind LIKE 'credit-%' AND c.kind <> 'credit-invalid';
SELECT ok((SELECT SUM(l.debit)=110000 AND SUM(l.credit)=110000 AND count(*)=2 FROM journal_entry_lines l
 WHERE l.journal_entry_id=e.payment_je_id),'credit settlement JE is balanced with TTC amount: '||c.kind)
 FROM ep_cases c JOIN expenses e USING(id) WHERE c.kind LIKE 'credit-%' AND c.kind <> 'credit-invalid';
SELECT ok(a.actor_id=(SELECT profile_id FROM ep_actor) AND a.metadata->>'payment_method'=e.payment_method,
 'audit actor and method match persisted expense: '||c.kind)
 FROM ep_cases c JOIN expenses e USING(id) JOIN audit_logs a ON a.entity_id=e.id AND a.action='expense.pay'
 WHERE c.kind <> 'credit-invalid';
SELECT is((SELECT count(*) FROM audit_logs a JOIN ep_cases c ON c.id=a.entity_id WHERE a.action='expense.pay'),
 8::bigint,'exactly one payment audit per successful settlement');
SELECT is((SELECT status FROM expenses WHERE id=(SELECT id FROM ep_cases WHERE kind='credit-invalid')),
 'approved','failed credit settlement leaves original approval intact');
SELECT ok(to_regprocedure('public.pay_expense_v3(uuid,text)') IS NULL,'old payment signature removed');
SELECT ok(NOT has_function_privilege('anon','public.pay_expense_v4(uuid,text)','EXECUTE')
 AND has_function_privilege('authenticated','public.pay_expense_v4(uuid,text)','EXECUTE')
 AND has_function_privilege('service_role','public.pay_expense_v4(uuid,text)','EXECUTE'),'payment ACL preserved');
SELECT * FROM finish();
ROLLBACK;
