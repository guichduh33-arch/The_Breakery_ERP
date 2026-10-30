-- Création durable et justificatifs privés ; fixtures autonomes, toutes sous rollback.
BEGIN;
\ir helpers/expense_terms.sql
\ir helpers/pin_session.sql
SELECT no_plan();
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('expense-receipts','expense-receipts',false,5242880,ARRAY['image/jpeg','image/png','image/webp','application/pdf']) ON CONFLICT(id) DO NOTHING;
CREATE TEMP TABLE er_actors(kind text PRIMARY KEY,auth_id uuid,profile_id uuid);
INSERT INTO er_actors SELECT k,gen_random_uuid(),gen_random_uuid()
 FROM unnest(ARRAY['creator','reader','manager','stranger']) k;
INSERT INTO auth.users(id) SELECT auth_id FROM er_actors;
INSERT INTO user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
 SELECT profile_id,auth_id,'CASHIER','ER-'||left(profile_id::text,8),'Receipt fixture '||kind,hash_pin('285741'),true FROM er_actors;
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.profile_id,p.code,(a.kind='creator' AND p.code='expenses.create')
 OR (a.kind='reader' AND p.code='expenses.read') OR (a.kind='manager' AND p.code='expenses.manage'),
 'Transactional receipt fixture' FROM er_actors a CROSS JOIN permissions p WHERE p.code LIKE 'expenses.%';
CREATE TEMP TABLE er_vars(name text PRIMARY KEY,v uuid,path text);
INSERT INTO er_vars(name,v) SELECT k,gen_random_uuid() FROM unnest(ARRAY[
 'creation-key','attach-key','second-key','remove-key','stale-key','draft-only-key','missing-key','other','legacy','legacy-key']) k;
WITH a AS (
 INSERT INTO accounts(code,name,account_class,account_type,balance_type)
 VALUES('ER-'||gen_random_uuid(),'Receipt expense charge fixture',6,'expense','debit') RETURNING id
), c AS (
 INSERT INTO expense_categories(code,name,account_id)
 SELECT 'ER-'||gen_random_uuid(),'Receipt expense fixture',id FROM a RETURNING id
) INSERT INTO er_vars(name,v) SELECT 'category',id FROM c;
GRANT SELECT ON er_actors TO authenticated;
GRANT SELECT,INSERT,UPDATE ON er_vars TO authenticated;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM er_actors WHERE kind='creator')); END $$;
SET LOCAL ROLE authenticated;
SELECT ok(public.request_has_active_pin_session_v1(),'creator has a real active PIN session');
INSERT INTO er_vars(name,v) SELECT 'main',public.create_expense_v4(
 (SELECT v FROM er_vars WHERE name='category'),250000,'cash','Receipt recovery fixture',CURRENT_DATE,
 p_idempotency_key=>(SELECT v FROM er_vars WHERE name='creation-key'), p_expense_term_id => pg_temp.expense_term_fixture((SELECT v FROM er_vars WHERE name='category'), 'Receipt recovery fixture'));
SELECT is(public.create_expense_v4((SELECT v FROM er_vars WHERE name='category'),1,'cash','Replay payload',CURRENT_DATE,
 p_idempotency_key=>(SELECT v FROM er_vars WHERE name='creation-key'), p_expense_term_id => pg_temp.expense_term_fixture((SELECT v FROM er_vars WHERE name='category'), 'Replay payload')),
 (SELECT v FROM er_vars WHERE name='main'),'creation replay retains the real ID and original payload');
SELECT is((SELECT amount FROM expenses WHERE id=(SELECT v FROM er_vars WHERE name='main')),250000::numeric,'creation replay does not edit the saved amount');
SELECT is((SELECT created_by FROM expenses WHERE id=(SELECT v FROM er_vars WHERE name='main')),
 (SELECT profile_id FROM er_actors WHERE kind='creator'),'audit/profile identity differs from auth uid');
SELECT throws_ok($q$ SELECT public.create_expense_v4((SELECT v FROM er_vars WHERE name='category'),1,'cash','Premature receipt',CURRENT_DATE,
 p_receipt_url=>'expenses/untrusted/receipt.pdf', p_expense_term_id => pg_temp.expense_term_fixture((SELECT v FROM er_vars WHERE name='category'), 'Premature receipt')) $q$,'22023','receipt_requires_saved_draft','creation refuses a receipt before the draft exists');
SELECT ok(NOT has_table_privilege('authenticated','public.expenses','INSERT')
 AND NOT has_table_privilege('authenticated','public.expenses','UPDATE')
 AND NOT has_table_privilege('authenticated','public.expenses','DELETE')
 AND NOT has_table_privilege('authenticated','public.expenses','TRUNCATE'),'direct expense writes cannot bypass RPC guards');
RESET ROLE;
SELECT is((SELECT count(*) FROM expense_creation_results WHERE expense_id=(SELECT v FROM er_vars WHERE name='main')),
 1::bigint,'exactly one permanent creation result exists');
INSERT INTO expenses(id,expense_number,category_id,amount,payment_method,description,expense_date,created_by,status,receipt_url,idempotency_key, expense_term_id)
 SELECT v.v,'ER-'||v.v,c.v,100,'cash','Other receipt fixture',CURRENT_DATE,a.profile_id,'draft',NULL,NULL
, pg_temp.expense_term_fixture(c.v, 'Other receipt fixture') FROM er_vars v CROSS JOIN er_vars c CROSS JOIN er_actors a WHERE v.name='other' AND c.name='category' AND a.kind='stranger';
INSERT INTO expenses(id,expense_number,category_id,amount,payment_method,description,expense_date,created_by,status,receipt_url,idempotency_key, expense_term_id)
 SELECT v.v,'ER-'||v.v,c.v,100,'cash','Historical receipt fixture',CURRENT_DATE,a.profile_id,'submitted',
 'expenses/'||gen_random_uuid()||'/receipt.pdf',NULL
, pg_temp.expense_term_fixture(c.v, 'Historical receipt fixture') FROM er_vars v CROSS JOIN er_vars c CROSS JOIN er_actors a WHERE v.name='legacy' AND c.name='category' AND a.kind='creator';
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts',receipt_url,a.auth_id::text,jsonb_build_object('mimetype','application/pdf','size',7)
 FROM expenses e CROSS JOIN er_actors a WHERE e.id=(SELECT v FROM er_vars WHERE name='legacy') AND a.kind='creator';
UPDATE er_vars SET path='expenses/'||(SELECT v FROM er_vars WHERE name='main')||'/'||v||'.pdf'
 WHERE name IN ('attach-key','second-key','missing-key');
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts',v.path,a.auth_id::text,jsonb_build_object('mimetype','application/pdf','size',7)
 FROM er_vars v CROSS JOIN er_actors a WHERE v.name IN ('attach-key','second-key') AND a.kind='creator';
INSERT INTO expense_approvals(expense_id,approver_user_id,step)
 SELECT v,(SELECT profile_id FROM er_actors WHERE kind='manager'),1 FROM er_vars WHERE name IN ('main','other','legacy');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM expenses WHERE id IN (SELECT v FROM er_vars WHERE name IN ('main','other','legacy'))),2::bigint,
 'creator without general read sees own draft and submitted expense only');
SELECT is((SELECT count(*) FROM expense_approvals WHERE expense_id IN (SELECT v FROM er_vars WHERE name IN ('main','other','legacy'))),
 2::bigint,'creator sees approvals only for its visible expenses');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='expense-receipts' AND name=(
 SELECT receipt_url FROM expenses WHERE id=(SELECT v FROM er_vars WHERE name='legacy'))),0::bigint,
 'historical receipt requires the authenticated proxy too');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='expense-receipts' AND name=(SELECT path FROM er_vars WHERE name='attach-key')),
 0::bigint,'an unattached object cannot be read through the private bucket');
SELECT throws_ok($q$SELECT public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),
 (SELECT path FROM er_vars WHERE name='missing-key'),NULL,(SELECT v FROM er_vars WHERE name='missing-key'))$q$,
 'P0002','receipt_object_not_found','missing object leaves attachment unresolved');
SELECT ok((public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),(SELECT path FROM er_vars WHERE name='attach-key'),
 NULL,(SELECT v FROM er_vars WHERE name='attach-key'))->>'applied')::boolean,'saved draft attaches an owned immutable object');
SELECT ok((public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),(SELECT path FROM er_vars WHERE name='attach-key'),
 NULL,(SELECT v FROM er_vars WHERE name='attach-key'))->>'idempotent_replay')::boolean,'attachment replay returns its first result');
SELECT throws_ok($q$SELECT public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),NULL,NULL,
 (SELECT v FROM er_vars WHERE name='attach-key'))$q$,'22023','expense_receipt_key_conflict','a receipt key cannot be reused for a different payload');
SELECT ok((public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),(SELECT path FROM er_vars WHERE name='second-key'),
 (SELECT path FROM er_vars WHERE name='attach-key'),(SELECT v FROM er_vars WHERE name='second-key'))->>'applied')::boolean,
 'draft may replace its reference with another immutable object');
SELECT lives_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts','expenses/'||v||'/'||gen_random_uuid()||'.pdf',auth.uid()::text,
 '{"mimetype":"application/pdf","size":7}'::jsonb FROM er_vars WHERE name='main'$q$,
 'creator can upload a new immutable object to its saved draft');
SELECT throws_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts','expenses/'||v||'/'||gen_random_uuid()||'.pdf',auth.uid()::text,'{}'::jsonb
 FROM er_vars WHERE name='other'$q$,'42501',NULL,'creator cannot upload into another draft');
SELECT throws_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts','expenses/'||v||'/receipt.pdf',auth.uid()::text,'{}'::jsonb
 FROM er_vars WHERE name='main'$q$,'42501',NULL,'new upload cannot use a mutable legacy filename');
WITH changed AS (UPDATE storage.objects SET metadata='{}'::jsonb
 WHERE name=(SELECT path FROM er_vars WHERE name='second-key') RETURNING 1)
 SELECT is(count(*),0::bigint,'referenced object cannot be overwritten') FROM changed;
SELECT throws_ok($q$DELETE FROM storage.objects WHERE name=(SELECT path FROM er_vars WHERE name='second-key')$q$,
 '42501',NULL,'platform refuses direct Storage deletion; HTTP Storage delete requires its own test');
SELECT is(public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),NULL,
 (SELECT path FROM er_vars WHERE name='attach-key'),(SELECT v FROM er_vars WHERE name='stale-key'))->>'reason',
 'receipt_changed','stale compare-and-set produces a persisted explicit refusal');
SELECT is(public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),(SELECT path FROM er_vars WHERE name='attach-key'),
 NULL,(SELECT v FROM er_vars WHERE name='attach-key'))->>'receipt_path',(SELECT path FROM er_vars WHERE name='attach-key'),
 'old successful replay retains its original response after a later replacement');
SELECT is((SELECT receipt_url FROM expenses WHERE id=(SELECT v FROM er_vars WHERE name='main')),
 (SELECT path FROM er_vars WHERE name='second-key'),'old replay does not restore the superseded receipt');
RESET ROLE;
SELECT is((SELECT count(*) FROM audit_logs WHERE entity_id=(SELECT v FROM er_vars WHERE name='main') AND action='expense.receipt_updated'),
 2::bigint,'only the two successful reference changes emit a receipt audit');
SELECT ok((SELECT bool_and(actor_id=(SELECT profile_id FROM er_actors WHERE kind='creator') AND payload ? 'receipt_url'
 AND NOT metadata ? 'receipt_url') FROM audit_logs WHERE entity_id=(SELECT v FROM er_vars WHERE name='main') AND action='expense.receipt_updated'),
 'receipt audit keeps profile actor, context and diff separate');
UPDATE expenses SET status='submitted',idempotency_key=gen_random_uuid() WHERE id=(SELECT v FROM er_vars WHERE name='main');
SET LOCAL ROLE authenticated;
SELECT is(public.create_expense_v4((SELECT v FROM er_vars WHERE name='category'),1,'cash','Retry after submit',CURRENT_DATE,
 p_idempotency_key=>(SELECT v FROM er_vars WHERE name='creation-key'), p_expense_term_id => pg_temp.expense_term_fixture((SELECT v FROM er_vars WHERE name='category'), 'Retry after submit')),(SELECT v FROM er_vars WHERE name='main'),
 'creation replay survives replacement of the expense idempotency column at submit');
SELECT is((SELECT status FROM expenses WHERE id=(SELECT v FROM er_vars WHERE name='main')),'submitted','creation replay never resets the submitted status');
SELECT is(public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),NULL,
 (SELECT path FROM er_vars WHERE name='second-key'),(SELECT v FROM er_vars WHERE name='draft-only-key'))->>'reason',
 'receipt_requires_draft','submitted expense rejects a new receipt change explicitly');
SELECT ok((public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),(SELECT path FROM er_vars WHERE name='attach-key'),
 NULL,(SELECT v FROM er_vars WHERE name='attach-key'))->>'applied')::boolean,'a confirmed historical attempt can resolve after submission');
SELECT is((SELECT receipt_url FROM expenses WHERE id=(SELECT v FROM er_vars WHERE name='main')),
 (SELECT path FROM er_vars WHERE name='second-key'),'replay after submit leaves the actual reference untouched');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM er_actors WHERE kind='reader')); END $$;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM expenses WHERE id IN (SELECT v FROM er_vars WHERE name IN ('main','other','legacy'))),3::bigint,
 'read permission sees every fixture expense without requiring manage');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='expense-receipts' AND name IN (SELECT receipt_url FROM expenses WHERE id IN (
 SELECT v FROM er_vars WHERE name IN ('main','legacy')))),0::bigint,'reader cannot bypass the authenticated download proxy');
SELECT is((SELECT count(*) FROM expense_approvals WHERE expense_id IN (SELECT v FROM er_vars WHERE name IN ('main','other','legacy'))),
 3::bigint,'reader sees the approvals of every visible fixture expense');
SELECT throws_ok($q$SELECT public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),NULL,NULL,gen_random_uuid())$q$,
 '42501','permission_denied','reader cannot change a receipt');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM er_actors WHERE kind='manager')); END $$;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM expenses WHERE id IN (SELECT v FROM er_vars WHERE name IN ('main','other','legacy'))),3::bigint,
 'manage permission sees every fixture expense without requiring read');
SELECT is(public.set_expense_receipt_v1((SELECT v FROM er_vars WHERE name='main'),NULL,
 (SELECT path FROM er_vars WHERE name='second-key'),gen_random_uuid())->>'reason',
 'receipt_requires_draft','manager cannot change a submitted receipt either');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM er_actors WHERE kind='stranger')); END $$;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM expenses WHERE id IN (SELECT v FROM er_vars WHERE name IN ('main','legacy'))),0::bigint,
 'unrelated authenticated operator cannot read private expenses');
SELECT is((SELECT count(*) FROM expense_approvals WHERE expense_id IN (SELECT v FROM er_vars WHERE name IN ('main','legacy'))),
 0::bigint,'unrelated operator cannot read private approval rows');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='expense-receipts' AND name IN (SELECT path FROM er_vars)),0::bigint,
 'unrelated authenticated operator cannot read the receipt objects');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon','public.create_expense_v4(uuid,numeric,text,text,date,numeric,text,text,uuid,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.set_expense_receipt_v1(uuid,text,text,uuid)','EXECUTE'),'anon has no inherited PUBLIC execute');
SELECT ok(NOT has_function_privilege('authenticated','public._read_expense_creation_v1(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public._read_expense_receipt_v1(uuid,uuid,uuid,jsonb)','EXECUTE'),'idempotency helpers are private');
SELECT ok(NOT has_table_privilege('authenticated','public.expense_creation_results','SELECT')
 AND NOT has_table_privilege('authenticated','public.expense_receipt_results','SELECT'),'result ledgers are not exposed to clients');
SELECT ok(to_regprocedure('public.create_expense_v2(uuid,numeric,text,text,date,numeric,text,text,uuid)') IS NULL,'previous creation signature is removed');
SELECT ok(NOT (SELECT public FROM storage.buckets WHERE id='expense-receipts'),'receipt bucket remains private');
SELECT * FROM finish();
ROLLBACK;
