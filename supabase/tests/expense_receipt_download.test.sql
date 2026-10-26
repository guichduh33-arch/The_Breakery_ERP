BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE rd_actors(kind text PRIMARY KEY, auth_id uuid, profile_id uuid, session_id uuid);
INSERT INTO rd_actors SELECT k,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
FROM unnest(ARRAY['creator','reader','manager','stranger']) k;
INSERT INTO auth.users(id) SELECT auth_id FROM rd_actors;
INSERT INTO public.user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
SELECT profile_id,auth_id,'CASHIER','RD-'||left(profile_id::text,8),'Receipt download fixture',public.hash_pin('285741'),true FROM rd_actors;
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT a.profile_id,p.code,(a.kind='reader' AND p.code='expenses.read')
 OR (a.kind='manager' AND p.code='expenses.manage'),'Receipt download transaction'
FROM rd_actors a CROSS JOIN public.permissions p WHERE p.code LIKE 'expenses.%';
INSERT INTO public.user_sessions(id,user_id,session_token_hash,device_type,permissions_snapshot,session_timeout_minutes)
SELECT session_id,profile_id,'pgtap-receipt-'||session_id,'pos',ARRAY[]::text[],30 FROM rd_actors;
CREATE TEMP TABLE rd_expense(id uuid,path text);
WITH a AS (
 INSERT INTO public.accounts(code,name,account_class,account_type,balance_type)
 VALUES('RD-'||gen_random_uuid(),'Receipt fixture',6,'expense','debit') RETURNING id
), c AS (
 INSERT INTO public.expense_categories(code,name,account_id)
 SELECT 'RD-'||gen_random_uuid(),'Receipt fixture',id FROM a RETURNING id
), e AS (
 INSERT INTO public.expenses(expense_number,category_id,amount,payment_method,description,expense_date,created_by,status,receipt_url)
 SELECT 'RD-'||gen_random_uuid(),c.id,100,'cash','Receipt fixture',CURRENT_DATE,a.profile_id,'submitted',
 'expenses/historical/receipt.pdf' FROM c CROSS JOIN rd_actors a WHERE a.kind='creator' RETURNING id,receipt_url
) INSERT INTO rd_expense SELECT id,receipt_url FROM e;
GRANT SELECT ON rd_actors,rd_expense TO service_role,authenticated;
SELECT ok(NOT has_function_privilege('anon','public.authorize_expense_receipt_download_v1(uuid,uuid)','EXECUTE'),
 'anon cannot inherit authorization RPC via PUBLIC');
SELECT ok(NOT has_function_privilege('authenticated','public.authorize_expense_receipt_download_v1(uuid,uuid)','EXECUTE'),
 'authenticated cannot forge a session ID to the service RPC');
SELECT ok(has_function_privilege('service_role','public.authorize_expense_receipt_download_v1(uuid,uuid)','EXECUTE'),
 'only service role can resolve the authorized path');
SET LOCAL ROLE service_role;
SELECT is(public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='creator'),
 (SELECT id FROM rd_expense)),(SELECT path FROM rd_expense),'creator reads own submitted historical receipt without general permission');
SELECT is(public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='reader'),
 (SELECT id FROM rd_expense)),(SELECT path FROM rd_expense),'current read grant works despite empty permission snapshot');
SELECT is(public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='manager'),
 (SELECT id FROM rd_expense)),(SELECT path FROM rd_expense),'manage alone authorizes download');
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='stranger'),
 (SELECT id FROM rd_expense))$q$,'P0002','receipt_not_found','unrelated operator cannot resolve another receipt');
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='reader'),
 gen_random_uuid())$q$,'P0002','receipt_not_found','missing expense has the same response as inaccessible expense');
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1(gen_random_uuid(),
 (SELECT id FROM rd_expense))$q$,'PT401','session_expired','unknown session is rejected');
RESET ROLE;
UPDATE public.user_permission_overrides SET is_granted=false WHERE user_profile_id=(SELECT profile_id FROM rd_actors WHERE kind='reader');
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='reader'),
 (SELECT id FROM rd_expense))$q$,'P0002','receipt_not_found','removed permission takes effect immediately');
RESET ROLE;
UPDATE public.user_sessions SET ended_at=now() WHERE id=(SELECT session_id FROM rd_actors WHERE kind='creator');
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='creator'),
 (SELECT id FROM rd_expense))$q$,'PT401','session_expired','logout blocks even the creator');
RESET ROLE;
UPDATE public.user_sessions SET last_activity_at=now()-interval '31 minutes'
 WHERE id=(SELECT session_id FROM rd_actors WHERE kind='manager');
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='manager'),
 (SELECT id FROM rd_expense))$q$,'PT401','session_expired','idle timeout blocks a privileged operator');
RESET ROLE;
UPDATE public.user_sessions SET last_activity_at=now() WHERE id=(SELECT session_id FROM rd_actors WHERE kind='manager');
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT profile_id FROM rd_actors WHERE kind='manager');
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='manager'),
 (SELECT id FROM rd_expense))$q$,'PT401','session_expired','disabled profile cannot download');
RESET ROLE;
UPDATE public.user_profiles SET is_active=true WHERE id=(SELECT profile_id FROM rd_actors WHERE kind='manager');
UPDATE public.expenses SET deleted_at=now() WHERE id=(SELECT id FROM rd_expense);
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='manager'),
 (SELECT id FROM rd_expense))$q$,'P0002','receipt_not_found','deleted expense cannot be downloaded');
RESET ROLE;
UPDATE public.expenses SET deleted_at=NULL,receipt_url=NULL WHERE id=(SELECT id FROM rd_expense);
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.authorize_expense_receipt_download_v1((SELECT session_id FROM rd_actors WHERE kind='manager'),
 (SELECT id FROM rd_expense))$q$,'P0002','receipt_not_found','missing reference cannot be downloaded');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
 AND policyname='expense_receipts_proxy_only' AND permissive='RESTRICTIVE' AND cmd='SELECT'
 AND roles @> ARRAY['anon','authenticated']::name[]),'restrictive read boundary applies to both client roles');
SELECT ok(EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
 AND policyname='expense_receipts_insert' AND cmd='INSERT'),'draft upload policy is preserved');
SELECT * FROM finish();
ROLLBACK;
