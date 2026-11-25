-- Le règlement d'une dette importée s'ajoute au registre de reprise sans le réécrire
-- (migration 20261125000007, garde _historical_import_entity_guard_v4).
--
--   Fournisseur : un bon importé à crédit se règle par la RPC ordinaire, dans la
--   limite de son total ; le paiement enregistré ne se modifie ni ne se supprime.
--   B2B : une facture importée se solde par le premier entré premier sorti ou
--   partiellement ; son total, sa suppression et un passage à paid non couvert
--   restent refusés.
BEGIN;
\ir helpers/invoice_forward.sql
SELECT plan(23);

-- Contexte d'import : un SUPER_ADMIN en session PIN, une reprise par nature.
UPDATE user_profiles SET role_code='SUPER_ADMIN' WHERE id=(SELECT profile_id FROM inf_actor WHERE kind='owner');
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='owner')); END $$;
INSERT INTO inf_state(tag) SELECT unnest(ARRAY['run_p','run_s','doc_p','doc_s1','doc_s2','po','inv1','inv2','customer','pay_key','po_key']);
INSERT INTO historical_import_runs(id,client_key,source_system,kind,batch_reference,payload_hash,preview_hash,actor_id,status,created_at)
 SELECT s.id,gen_random_uuid(),'IDS-'||s.id,CASE s.tag WHEN 'run_p' THEN 'purchases' ELSE 'sales' END,
  'Imported debt settlement',repeat('a',64),repeat('b',64),a.profile_id,'applying',now()
 FROM inf_state s CROSS JOIN inf_actor a WHERE s.tag IN ('run_p','run_s') AND a.kind='owner';
INSERT INTO customers(id,name,customer_type,b2b_company_name,b2b_credit_limit,b2b_current_balance)
 SELECT id,'Imported debt customer','b2b','PT Imported Debt',NULL,300 FROM inf_state WHERE tag='customer';

-- Bon fournisseur importé : 1000 à crédit. L'exemption d'octobre est figée et ne
-- se pose plus : le bon reçoit une facture justificative, comme une réparation.
SELECT set_config('breakery.historical_import_run',(SELECT id::text FROM inf_state WHERE tag='run_p'),true);
INSERT INTO historical_import_documents(id,run_id,source_system,kind,source_reference,source_hash,source_payload,entity_id,
 document_date,effective_at,time_precision,account_id,total_amount)
 SELECT d.id,r.id,'IDS-'||r.id,'purchases','PO import',repeat('c',64),'{}',p.id,
  current_date,now(),'day',(SELECT id FROM accounts ORDER BY code LIMIT 1),1000
 FROM inf_state d, inf_state r, inf_state p WHERE d.tag='doc_p' AND r.tag='run_p' AND p.tag='po';
INSERT INTO purchase_orders(id,po_number,supplier_id,status,payment_terms,subtotal,total_amount,created_by,
 financial_import_document_id)
 SELECT p.id,'IDS-'||p.id,s.id,'received','credit',1000,1000,a.profile_id,d.id
 FROM inf_state p, inf_state s, inf_state d, inf_actor a
 WHERE p.tag='po' AND s.tag='supplier' AND d.tag='doc_p' AND a.kind='owner';
UPDATE historical_import_runs SET status='applied' WHERE id=(SELECT id FROM inf_state WHERE tag='run_p');
SELECT set_config('breakery.historical_import_run','',true);
INSERT INTO inf_state(tag) VALUES('invoice_key');
UPDATE inf_state SET path='purchase-orders/'||(SELECT id FROM inf_state WHERE tag='po')||'/'||id||'.pdf' WHERE tag='invoice_key';
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'purchase-invoices',path,a.auth_id::text,'{"mimetype":"application/pdf","size":7}'
 FROM inf_state CROSS JOIN inf_actor a WHERE tag='invoice_key' AND a.kind='owner';
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='owner')); END $$;
SET LOCAL ROLE authenticated;
SELECT set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='po'),(SELECT path FROM inf_state WHERE tag='invoice_key'),
 NULL,(SELECT id FROM inf_state WHERE tag='invoice_key'));
RESET ROLE;

-- Factures B2B importées : 100 puis 200, toutes deux b2b_pending.
SELECT set_config('breakery.historical_import_run',(SELECT id::text FROM inf_state WHERE tag='run_s'),true);
INSERT INTO historical_import_documents(id,run_id,source_system,kind,source_reference,source_hash,source_payload,entity_id,
 document_date,effective_at,time_precision,account_id,total_amount)
 SELECT d.id,r.id,'IDS-'||r.id,'sales','B2B import '||d.tag,repeat('d',64),'{}',o.id,
  current_date,now(),'day',(SELECT id FROM accounts ORDER BY code LIMIT 1),CASE d.tag WHEN 'doc_s1' THEN 100 ELSE 200 END
 FROM inf_state d JOIN inf_state o ON o.tag=CASE d.tag WHEN 'doc_s1' THEN 'inv1' ELSE 'inv2' END
 CROSS JOIN inf_state r WHERE d.tag IN ('doc_s1','doc_s2') AND r.tag='run_s';
INSERT INTO orders(id,order_number,order_type,status,customer_id,subtotal,tax_amount,total,created_at,financial_import_document_id)
 SELECT o.id,'IDS-'||o.id,'b2b','b2b_pending',c.id,v.total,0,v.total,now()-v.age,d.id
 FROM (VALUES ('inv1','doc_s1',100::numeric,interval '2 days'),('inv2','doc_s2',200::numeric,interval '1 day')) v(tag,doc,total,age)
 JOIN inf_state o ON o.tag=v.tag JOIN inf_state d ON d.tag=v.doc CROSS JOIN inf_state c WHERE c.tag='customer';
-- Une ligne servie, comme à la reprise : le passage à paid ne doit pas tenter paid→completed.
INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status)
 SELECT o.id,(SELECT id FROM products ORDER BY created_at LIMIT 1),'Imported line',100,1,100,'served'
 FROM inf_state o WHERE o.tag='inv1';
UPDATE historical_import_runs SET status='applied' WHERE id=(SELECT id FROM inf_state WHERE tag='run_s');
SELECT set_config('breakery.historical_import_run','',true);

-- T1-T5 : fournisseur.
SELECT lives_ok($q$SELECT _record_po_payment_internal((SELECT id FROM inf_state WHERE tag='po'),600,'transfer','IDS',
 (SELECT id FROM inf_state WHERE tag='po_key'),(SELECT profile_id FROM inf_actor WHERE kind='owner'))$q$,
 'an imported credit purchase order accepts an ordinary payment');
SELECT is((SELECT sum(l.debit) FROM journal_entries j JOIN purchase_payments p ON p.id=j.reference_id
 JOIN journal_entry_lines l ON l.journal_entry_id=j.id
 WHERE j.reference_type='purchase_payment' AND l.account_id=resolve_mapping_account('PURCHASE_PAYABLE')
 AND p.purchase_order_id=(SELECT id FROM inf_state WHERE tag='po')),600::numeric,
 'the payment debits the supplier payable by its amount');
SELECT throws_ok($q$INSERT INTO purchase_payments(purchase_order_id,amount,method,paid_at,paid_by,idempotency_key)
 SELECT id,500,'transfer',now(),(SELECT profile_id FROM inf_actor WHERE kind='owner'),gen_random_uuid() FROM inf_state WHERE tag='po'$q$,
 'P0003','financial_import_requires_dedicated_workflow','a payment beyond the imported total stays refused');
SELECT throws_ok($q$UPDATE purchase_payments SET amount=1 WHERE purchase_order_id=(SELECT id FROM inf_state WHERE tag='po')$q$,
 'P0003','financial_import_requires_dedicated_workflow','a recorded payment on an imported order cannot be edited');
SELECT throws_ok($q$DELETE FROM purchase_payments WHERE purchase_order_id=(SELECT id FROM inf_state WHERE tag='po')$q$,
 'P0003','financial_import_requires_dedicated_workflow','a recorded payment on an imported order cannot be deleted');

-- T6-T13 : B2B, règlement de 150 en premier entré premier sorti.
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='owner')); END $$;
SELECT lives_ok($q$SELECT record_b2b_payment_v7(p_customer_id:=(SELECT id FROM inf_state WHERE tag='customer'),
 p_amount:=150,p_method:='transfer',p_idempotency_key:=(SELECT id FROM inf_state WHERE tag='pay_key'))$q$,
 'a B2B payment can be allocated to imported invoices');
SELECT is((SELECT status::text FROM orders WHERE id=(SELECT id FROM inf_state WHERE tag='inv1')),'paid',
 'the oldest imported invoice is settled first');
SELECT is((SELECT status::text FROM orders WHERE id=(SELECT id FROM inf_state WHERE tag='inv2')),'b2b_pending',
 'a partially settled imported invoice stays pending');
SELECT is((SELECT sum(amount_applied) FROM b2b_payment_allocations WHERE invoice_id=(SELECT id FROM inf_state WHERE tag='inv2')),50::numeric,
 'the remainder is allocated to the next imported invoice');
SELECT is((SELECT b2b_current_balance FROM customers WHERE id=(SELECT id FROM inf_state WHERE tag='customer')),150::numeric,
 'the customer balance drops by the payment');
SELECT is((SELECT sum(l.credit) FROM journal_entries j JOIN b2b_payments p ON p.journal_entry_id=j.id
 JOIN journal_entry_lines l ON l.journal_entry_id=j.id
 WHERE p.idempotency_key=(SELECT id FROM inf_state WHERE tag='pay_key') AND j.reference_type='b2b_payment'
 AND l.account_id=resolve_mapping_account('B2B_AR')),150::numeric,
 'the B2B payment credits the B2B receivable by its amount');
SELECT is((SELECT status::text FROM orders WHERE id=(SELECT id FROM inf_state WHERE tag='inv1')),'paid',
 'a settled imported invoice with served lines stays paid, never auto-completed');
SELECT is((SELECT count(*) FROM journal_entries WHERE reference_type='sale'
 AND reference_id IN (SELECT id FROM inf_state WHERE tag IN ('inv1','inv2'))),0::bigint,
 'settling an imported invoice never emits a sale entry');

-- T14-T20 : ce qui reste fermé.
SELECT throws_ok($q$UPDATE orders SET status='paid',paid_at=now() WHERE id=(SELECT id FROM inf_state WHERE tag='inv2')$q$,
 'P0003','financial_import_requires_dedicated_workflow','an imported invoice cannot be marked paid without allocations');
SELECT throws_ok($q$UPDATE orders SET total=1 WHERE id=(SELECT id FROM inf_state WHERE tag='inv2')$q$,
 'P0003','financial_import_requires_dedicated_workflow','an imported invoice total stays immutable');
SELECT throws_ok($q$INSERT INTO b2b_payment_allocations(payment_id,invoice_id,amount_applied)
 SELECT p.id,i.id,151 FROM b2b_payments p, inf_state i
 WHERE p.idempotency_key=(SELECT id FROM inf_state WHERE tag='pay_key') AND i.tag='inv2'$q$,
 'P0003','financial_import_requires_dedicated_workflow','an allocation beyond the imported invoice stays refused');
SELECT throws_ok($q$DELETE FROM b2b_payment_allocations WHERE invoice_id=(SELECT id FROM inf_state WHERE tag='inv1')$q$,
 'P0003','financial_import_requires_dedicated_workflow','an allocation on an imported invoice cannot be deleted');
SELECT throws_ok($q$INSERT INTO b2b_payment_allocations(payment_id,invoice_id,amount_applied)
 SELECT p.id,i.id,1 FROM b2b_payments p, inf_state i
 WHERE p.idempotency_key=(SELECT id FROM inf_state WHERE tag='pay_key') AND i.tag='inv1'$q$,
 'P0003','financial_import_requires_dedicated_workflow','a paid imported invoice accepts no further allocation');
SELECT throws_ok($q$UPDATE orders SET status='b2b_pending' WHERE id=(SELECT id FROM inf_state WHERE tag='inv1')$q$,
 'P0003','financial_import_requires_dedicated_workflow','a paid imported invoice cannot be reopened');
SELECT throws_ok($q$UPDATE orders SET status='voided' WHERE id=(SELECT id FROM inf_state WHERE tag='inv2')$q$,
 'P0003','financial_import_requires_dedicated_workflow','an imported invoice can only move to paid');

-- T21-T23 : une facture couverte ne passe à paid que sans autre changement.
-- Le contrôle d'équilibre du paiement est différé et ne s'exécute jamais avant le ROLLBACK.
INSERT INTO inf_state(tag) VALUES('cover_pay');
INSERT INTO b2b_payments(id,payment_number,customer_id,amount,method,paid_at,created_by,allocation)
 SELECT p.id,'IDS-'||p.id,c.id,150,'transfer',now(),a.profile_id,'[]'
 FROM inf_state p, inf_state c, inf_actor a WHERE p.tag='cover_pay' AND c.tag='customer' AND a.kind='owner';
INSERT INTO b2b_payment_allocations(payment_id,invoice_id,amount_applied)
 SELECT p.id,i.id,150 FROM inf_state p, inf_state i WHERE p.tag='cover_pay' AND i.tag='inv2';
SELECT throws_ok($q$UPDATE orders SET status='paid',paid_at=now(),total=201 WHERE id=(SELECT id FROM inf_state WHERE tag='inv2')$q$,
 'P0003','financial_import_requires_dedicated_workflow','settling cannot smuggle a total change');
SELECT throws_ok($q$UPDATE orders SET status='paid',paid_at=now(),customer_id=NULL WHERE id=(SELECT id FROM inf_state WHERE tag='inv2')$q$,
 'P0003','financial_import_requires_dedicated_workflow','settling cannot smuggle a customer change');
SELECT lives_ok($q$UPDATE orders SET status='paid',paid_at=now() WHERE id=(SELECT id FROM inf_state WHERE tag='inv2')$q$,
 'a fully allocated imported invoice can be marked paid');

SELECT * FROM finish();
ROLLBACK;
