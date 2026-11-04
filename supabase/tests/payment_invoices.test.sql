-- Contrats DB des factures : objets Storage simulés par métadonnées, sans upload d'octets.
BEGIN;
\ir helpers/expense_terms.sql
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE iv_actor(kind text PRIMARY KEY,auth_id uuid,profile_id uuid);
INSERT INTO iv_actor SELECT k,gen_random_uuid(),gen_random_uuid() FROM unnest(ARRAY['owner','payer','stranger']) k;
INSERT INTO auth.users(id) SELECT auth_id FROM iv_actor;
INSERT INTO user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
 SELECT profile_id,auth_id,'CASHIER','IV-'||left(profile_id::text,8),'Invoice fixture '||kind,hash_pin('285741'),true FROM iv_actor;
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.profile_id,p.code,CASE WHEN a.kind='owner' THEN p.code IN ('expenses.create','expenses.read','purchasing.po.create','purchasing.po.read','purchasing.po.pay')
 WHEN a.kind='payer' THEN p.code IN ('expenses.pay','expenses.read') ELSE false END,'Invoice fixture'
 FROM iv_actor a CROSS JOIN permissions p WHERE p.code LIKE 'expenses.%' OR p.code LIKE 'purchasing.po.%';
CREATE TEMP TABLE iv_vars(k text PRIMARY KEY,id uuid,path text);
WITH a AS (INSERT INTO accounts(code,name,account_class,account_type,balance_type)
 VALUES('IV-'||gen_random_uuid(),'Invoice fixture charge',6,'expense','debit') RETURNING id),
 c AS (INSERT INTO expense_categories(code,name,account_id) SELECT 'IV-'||gen_random_uuid(),'Invoice fixture',id FROM a RETURNING id)
 INSERT INTO iv_vars SELECT 'category',id,NULL FROM c;
INSERT INTO expense_approval_thresholds(category_id,amount_min,amount_max,steps)
 SELECT id,0,1000000,'[]' FROM iv_vars WHERE k='category';
WITH s AS (INSERT INTO suppliers(code,name,is_active) VALUES('IV-'||gen_random_uuid(),'Invoice supplier',true) RETURNING id)
 INSERT INTO iv_vars(k,id) SELECT 'supplier',id FROM s;
INSERT INTO iv_vars(k,id) SELECT k,gen_random_uuid() FROM unnest(ARRAY['cash','transfer','legacy','submitted','import-before','import-boundary','po','attach','replacement','pay-key']) k;
INSERT INTO expenses(id,expense_number,category_id,amount,payment_method,description,expense_date,created_by,status,expense_term_id)
 SELECT v.id,'IV-'||v.id,c.id,100,CASE WHEN v.k='transfer' THEN 'transfer' ELSE 'cash' END,
 'Invoice fixture',CURRENT_DATE,a.profile_id,CASE WHEN v.k='submitted' THEN 'submitted' ELSE 'draft' END,
 pg_temp.expense_term_fixture(c.id,'Invoice fixture')
 FROM iv_vars v CROSS JOIN iv_vars c CROSS JOIN iv_actor a
 WHERE v.k IN ('cash','transfer','legacy','submitted') AND c.k='category' AND a.kind='owner';
INSERT INTO purchase_orders(id,po_number,supplier_id,status,payment_terms,subtotal,total_amount,created_by)
 SELECT p.id,'IV-'||p.id,s.id,'pending','credit',1000,1000,a.profile_id
 FROM iv_vars p CROSS JOIN iv_vars s CROSS JOIN iv_actor a WHERE p.k='po' AND s.k='supplier' AND a.kind='owner';
UPDATE iv_vars SET path=CASE WHEN k IN ('attach','replacement') THEN 'purchase-orders/'||(SELECT id FROM iv_vars WHERE k='po')||'/'||id||'.pdf' END
 WHERE k IN ('attach','replacement');
GRANT SELECT ON iv_actor TO authenticated;
GRANT SELECT,INSERT,UPDATE ON iv_vars TO authenticated;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM iv_actor WHERE kind='owner')); END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT submit_expense_v3((SELECT id FROM iv_vars WHERE k='cash'))$q$,'22023','invoice_required_before_approval',
 'cash auto-approval refuses missing invoice');
SELECT is((SELECT status FROM expenses WHERE id=(SELECT id FROM iv_vars WHERE k='cash')),'draft','failed cash validation leaves draft');
SELECT throws_ok($q$SELECT set_po_invoice_v1((SELECT id FROM iv_vars WHERE k='po'),(SELECT path FROM iv_vars WHERE k='attach'),NULL,
 (SELECT id FROM iv_vars WHERE k='attach'))$q$,'P0002','invoice_object_not_found','attachment requires existing object');
SELECT throws_ok($q$SELECT record_po_payment_v2((SELECT id FROM iv_vars WHERE k='po'),10,'cash',NULL,gen_random_uuid())$q$,
 '22023','invoice_required_before_payment','PO payment refuses missing invoice');
SELECT lives_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'purchase-invoices',path,auth.uid()::text,'{"mimetype":"application/pdf","size":7}' FROM iv_vars WHERE k='attach'$q$,
 'active authorized owner can create immutable PO object metadata');
SELECT ok((set_po_invoice_v1((SELECT id FROM iv_vars WHERE k='po'),(SELECT path FROM iv_vars WHERE k='attach'),NULL,
 (SELECT id FROM iv_vars WHERE k='attach'))->>'applied')::boolean,'PO invoice association succeeds');
SELECT ok((set_po_invoice_v1((SELECT id FROM iv_vars WHERE k='po'),(SELECT path FROM iv_vars WHERE k='attach'),NULL,
 (SELECT id FROM iv_vars WHERE k='attach'))->>'idempotent_replay')::boolean,'invoice retry returns durable first result');
SELECT throws_ok($q$SELECT set_po_invoice_v1((SELECT id FROM iv_vars WHERE k='po'),NULL,NULL,
 (SELECT id FROM iv_vars WHERE k='attach'))$q$,'22023','po_invoice_key_conflict','changed payload cannot reuse association key');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='purchase-invoices'),0::bigint,'PO bytes are inaccessible through direct Storage SELECT');
INSERT INTO iv_vars(k,id) SELECT 'payment',(record_po_payment_v2((SELECT id FROM iv_vars WHERE k='po'),100,'cash',NULL,
 (SELECT id FROM iv_vars WHERE k='pay-key'))->>'payment_id')::uuid;
SELECT ok((record_po_payment_v2((SELECT id FROM iv_vars WHERE k='po'),100,'cash',NULL,
 (SELECT id FROM iv_vars WHERE k='pay-key'))->>'idempotent_replay')::boolean,'payment replay remains possible');
SELECT is(set_po_invoice_v1((SELECT id FROM iv_vars WHERE k='po'),NULL,(SELECT path FROM iv_vars WHERE k='attach'),gen_random_uuid())->>'reason',
 'invoice_requires_unpaid_order','invoice cannot be removed after first payment');
RESET ROLE;
SELECT is((SELECT count(*) FROM purchase_payments WHERE purchase_order_id=(SELECT id FROM iv_vars WHERE k='po')),1::bigint,'replay creates no duplicate ledger row');
SELECT throws_ok($q$UPDATE expenses SET invoice_exempt=true WHERE id=(SELECT id FROM iv_vars WHERE k='cash')$q$,
 '42501','invoice_exemption_immutable','even privileged writes cannot manufacture exemption');
SELECT throws_ok($q$INSERT INTO expenses(expense_number,category_id,amount,payment_method,description,expense_date,created_by,status,is_historical_import)
 SELECT 'IV-IMPORT-'||gen_random_uuid(),c.id,1,'cash','Imported without invoice',date '2026-10-01',a.profile_id,'paid',true
 FROM iv_vars c CROSS JOIN iv_actor a WHERE c.k='category' AND a.kind='owner'$q$,
 '22023','invoice_required_before_payment','new import of an old paid expense is not exempt');
SELECT throws_ok($q$INSERT INTO expense_approvals(expense_id,approver_user_id,step)
 SELECT v.id,a.profile_id,1 FROM iv_vars v CROSS JOIN iv_actor a WHERE v.k='submitted' AND a.kind='payer'$q$,
 '22023','invoice_required_before_approval','first approval step also requires cash invoice');
-- Métadonnées simulant une pièce JPEG conforme et une ancienne pièce PNG.
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts','expenses/'||v.id||'/'||gen_random_uuid()||CASE WHEN v.k='legacy' THEN '.png' ELSE '.jpg' END,
 a.auth_id::text,jsonb_build_object('mimetype',CASE WHEN v.k='legacy' THEN 'image/png' ELSE 'image/jpeg' END,'size',7)
 FROM iv_vars v CROSS JOIN iv_actor a WHERE v.k IN ('cash','legacy','submitted','transfer') AND a.kind='owner';
UPDATE expenses e SET receipt_url=o.name FROM storage.objects o WHERE o.bucket_id='expense-receipts'
 AND o.name LIKE 'expenses/'||e.id||'/%' AND e.id IN (SELECT id FROM iv_vars WHERE k IN ('cash','legacy','submitted'));
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT submit_expense_v3((SELECT id FROM iv_vars WHERE k='cash'))$q$,'valid JPEG allows cash auto-approval');
SELECT throws_ok($q$SELECT submit_expense_v3((SELECT id FROM iv_vars WHERE k='legacy'))$q$,
 '22023','invoice_required_before_approval','PNG remains readable but does not justify new cash validation');
SELECT lives_ok($q$SELECT submit_expense_v3((SELECT id FROM iv_vars WHERE k='transfer'))$q$,'transfer expense can be validated before invoice');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM iv_actor WHERE kind='payer')); END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pay_expense_v5((SELECT id FROM iv_vars WHERE k='transfer'))$q$,
 '22023','invoice_required_before_payment','non-cash payment also requires invoice');
INSERT INTO iv_vars(k,id,path) SELECT 'transfer-key',gen_random_uuid(),NULL;
UPDATE iv_vars SET path='expenses/'||(SELECT id FROM iv_vars WHERE k='transfer')||'/'||id||'.pdf' WHERE k='transfer-key';
SELECT lives_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts',path,auth.uid()::text,'{"mimetype":"application/pdf","size":7}' FROM iv_vars WHERE k='transfer-key'$q$,
 'payer can upload missing invoice on already approved expense');
SELECT ok((set_expense_receipt_v2((SELECT id FROM iv_vars WHERE k='transfer'),(SELECT path FROM iv_vars WHERE k='transfer-key'),NULL,
 (SELECT id FROM iv_vars WHERE k='transfer-key'))->>'applied')::boolean,'payer can associate missing approved invoice');
SELECT lives_ok($q$SELECT pay_expense_v5((SELECT id FROM iv_vars WHERE k='transfer'))$q$,'invoice permits expense payment');
RESET ROLE;
SELECT is((SELECT status FROM expenses WHERE id=(SELECT id FROM iv_vars WHERE k='transfer')),'paid','expense is paid after justified settlement');
SELECT ok((SELECT bool_and(NOT public) FROM storage.buckets WHERE id IN ('expense-receipts','purchase-invoices')),'both invoice buckets remain private');
SELECT ok(NOT has_function_privilege('anon','public.set_po_invoice_v1(uuid,text,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.authorize_po_invoice_download_v1(uuid,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.authorize_po_invoice_download_v1(uuid,uuid)','EXECUTE'),'association and download RPC ACLs are distinct');
SELECT ok(to_regprocedure('public.set_expense_receipt_v1(uuid,text,text,uuid)') IS NULL
 AND to_regprocedure('public.pay_expense_v4(uuid,text)') IS NULL,'published old RPC signatures are removed');
SELECT * FROM finish();
ROLLBACK;
