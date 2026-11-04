-- Date réelle d'import et identité du registre, jamais la date de facture antidatée.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE ic_actor(auth_id uuid,profile_id uuid,account_id uuid,supplier_id uuid,category_id uuid);
INSERT INTO ic_actor(auth_id,profile_id) VALUES(gen_random_uuid(),gen_random_uuid());
INSERT INTO auth.users(id) SELECT auth_id FROM ic_actor;
INSERT INTO user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
 SELECT profile_id,auth_id,'SUPER_ADMIN','IC-'||left(profile_id::text,8),'Invoice cutoff fixture',hash_pin('285741'),true FROM ic_actor;
WITH a AS (INSERT INTO accounts(code,name,account_class,account_type,balance_type)
 VALUES('IC-'||gen_random_uuid(),'Invoice cutoff charge',6,'expense','debit') RETURNING id)
 UPDATE ic_actor SET account_id=a.id FROM a;
WITH c AS (INSERT INTO expense_categories(code,name,account_id)
 SELECT 'IC-'||gen_random_uuid(),'Invoice cutoff fixture',account_id FROM ic_actor RETURNING id)
 UPDATE ic_actor SET category_id=c.id FROM c;
WITH s AS (INSERT INTO suppliers(code,name,is_active) VALUES('IC-'||gen_random_uuid(),'Invoice cutoff supplier',true) RETURNING id)
 UPDATE ic_actor SET supplier_id=s.id FROM s;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM ic_actor)); END $$;
CREATE TEMP TABLE ic_cases(label text,id uuid,run_id uuid,doc_id uuid,imported_at timestamptz,expected boolean);
INSERT INTO ic_cases SELECT label,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),stamp,expected FROM (VALUES
 ('before',timestamptz '2026-10-30 23:59:59+08',true),
 ('boundary',timestamptz '2026-10-31 00:00:00+08',false),
 ('after',timestamptz '2026-10-31 00:00:01+08',false),
 ('backdated',timestamptz '2026-11-02 00:00:00+08',false)) x(label,stamp,expected);
DO $$ DECLARE c record; a ic_actor%ROWTYPE; BEGIN
 SELECT * INTO a FROM ic_actor;
 FOR c IN SELECT * FROM ic_cases LOOP
  INSERT INTO historical_import_runs(id,client_key,source_system,kind,batch_reference,payload_hash,preview_hash,actor_id,status,created_at)
   VALUES(c.run_id,gen_random_uuid(),'IC-'||c.id,'purchases',c.label,repeat('a',64),repeat('b',64),a.profile_id,'applying',c.imported_at);
  PERFORM set_config('breakery.historical_import_run',c.run_id::text,true);
  INSERT INTO historical_import_documents(id,run_id,source_system,kind,source_reference,source_hash,source_payload,entity_id,
   document_date,effective_at,time_precision,account_id,total_amount,created_at)
   VALUES(c.doc_id,c.run_id,'IC-'||c.id,'purchases',c.label,repeat('a',64),'{}',c.id,
    date '2026-10-01',timestamptz '2026-10-01 00:00:00+08','day',a.account_id,100,c.imported_at);
  INSERT INTO purchase_orders(id,po_number,supplier_id,status,payment_terms,subtotal,total_amount,order_date,created_at,created_by,
   financial_import_document_id,is_historical_import)
   VALUES(c.id,'IC-'||c.id,a.supplier_id,'received','credit',100,100,date '2026-10-01',timestamptz '2026-10-01 00:00:00+08',a.profile_id,c.doc_id,false);
  UPDATE historical_import_runs SET status='applied' WHERE id=c.run_id;
 END LOOP;
 PERFORM set_config('breakery.historical_import_run','',true);
END $$;
SELECT is(public._imported_before_invoice_cutoff_v1('purchase_order',id),expected,
 'PO cutoff uses registry actual import time: '||label) FROM ic_cases;
SELECT ok((SELECT bool_and(NOT is_historical_import) FROM purchase_orders WHERE id IN (SELECT id FROM ic_cases)),
 'real financial imports qualify through registry even with historical flag false');
SELECT throws_ok($q$UPDATE purchase_orders SET invoice_exempt=true WHERE id=(SELECT id FROM ic_cases WHERE label='before')$q$,
 'P0003','financial_import_requires_dedicated_workflow','cutoff helper does not permit clients to change frozen exemptions');
INSERT INTO expenses(id,expense_number,category_id,amount,payment_method,description,expense_date,status,is_historical_import,created_by,created_at)
 SELECT gen_random_uuid(),'IMP-EXP-IC-'||c.id,a.category_id,1,'cash','Historical fixture',date '2026-10-01','draft',true,a.profile_id,c.imported_at
 FROM ic_cases c CROSS JOIN ic_actor a;
SELECT ok(NOT public._imported_before_invoice_cutoff_v1('expense',e.id),'historical flag alone is insufficient: '||c.label)
 FROM expenses e JOIN ic_cases c ON e.expense_number='IMP-EXP-IC-'||c.id;
INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,created_at)
 SELECT created_by,'expenses.imported','expenses',id,'{}',created_at FROM expenses WHERE expense_number LIKE 'IMP-EXP-IC-%';
SELECT is(public._imported_before_invoice_cutoff_v1('expense',e.id),c.expected,
 'expense cutoff requires actual import time and matching audit: '||c.label)
 FROM expenses e JOIN ic_cases c ON e.expense_number='IMP-EXP-IC-'||c.id;
SELECT ok(NOT has_function_privilege('authenticated','public._imported_before_invoice_cutoff_v1(text,uuid)','EXECUTE'),
 'provenance evaluator remains internal');
SELECT * FROM finish();
ROLLBACK;
