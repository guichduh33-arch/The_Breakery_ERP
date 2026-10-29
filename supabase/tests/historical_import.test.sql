BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
\ir helpers/historical_import.sql
\ir helpers/historical_import_scope.sql
CREATE TEMP TABLE historical_payloads(label text PRIMARY KEY,payload jsonb);
INSERT INTO historical_payloads SELECT 'sale',payload FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok((SELECT bool_and(NOT has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE'))
 FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'historical_import_%'),'historical ledgers have no direct user grants');
INSERT INTO historical_tap(result) SELECT ok((SELECT bool_and(NOT has_function_privilege('anon',oid,'EXECUTE')) FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname LIKE '%historical_import%'),'anon has no RPC or helper access through PUBLIC');
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'valid preview separates ticket tax and actual partial payment') FROM historical_fixture;
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM historical_test_runs),0,'preview has no import writes');
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),0,'preview has no order writes');
INSERT INTO historical_tap(result) SELECT is((SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY date),'[]') FROM journal_entry_sequences s WHERE date>='2097-01-01'),
 sequences_before,'preview allocates no journal numbers') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.product),10::numeric,'preview preserves stock') FROM historical_fixture f;
-- Le helper interne est prive meme pour un utilisateur ayant les droits metier.
SET LOCAL ROLE authenticated;
INSERT INTO historical_tap(result) SELECT throws_ok('SELECT public._historical_import_context_v1()','42501',NULL,'authenticated cannot create an import context');
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM historical_test_runs),1,'one atomic import run');
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.product),9::numeric,'sale uses canonical stock helper once') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT created_at::date FROM stock_movements WHERE product_id=f.product AND movement_type='sale'),date '2097-01-10','stock is dated before insert to real sale day') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT status::text FROM orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),'pending_payment','partial payment preserves due state');
INSERT INTO historical_tap(result) SELECT is((SELECT paid_at FROM orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),NULL::timestamptz,'no final payment date invented');
INSERT INTO historical_tap(result) SELECT is((SELECT created_at FROM orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),timestamptz '2097-01-10 09:12:34+08','known sale timestamp is preserved exactly');
INSERT INTO historical_tap(result) SELECT is((SELECT created_at FROM stock_movements WHERE product_id=f.product AND movement_type='sale'),timestamptz '2097-01-10 09:12:34+08','sale stock preserves known source time') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT paid_at FROM order_payments WHERE order_id=(SELECT entity_id FROM historical_test_documents)),timestamptz '2097-02-02 17:18:19+08','known cash receipt timestamp is preserved exactly');
INSERT INTO historical_tap(result) SELECT is((SELECT served_by FROM orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),NULL::uuid,'technical importer is not credited as server');
INSERT INTO historical_tap(result) SELECT is((SELECT entry_date FROM journal_entries WHERE reference_type='pos_outstanding' AND reference_id=(SELECT entity_id FROM historical_test_documents)),date '2097-01-10','sale recognized on ticket day');
INSERT INTO historical_tap(result) SELECT is((SELECT entry_date FROM journal_entries WHERE id=(SELECT journal_entry_id FROM historical_test_allocations)),date '2097-02-02','cash receipt posted on actual later day');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='1131' AND j.metadata->>'financial_import_run_id'=f.result->>'run_id'),80::numeric,'retail receivable equals unpaid balance') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM notification_outbox),notifications_before,'historical sale and low stock send no notifications') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok((SELECT bool_and(total_debit=total_credit) FROM journal_entries WHERE metadata->>'financial_import_run_id'=f.result->>'run_id'),'all historical journal entries balance') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT actor_id FROM audit_logs WHERE action='historical_import.applied' AND entity_id=(f.result->>'run_id')::uuid),f.actor,'audit actor is profile ID') FROM historical_fixture f;
SET LOCAL ROLE authenticated;
INSERT INTO historical_tap(result) SELECT is(apply_historical_import_v3(payload,preview->>'preview_hash',client_key)->'idempotent_replay','true'::jsonb,'replay returns first result before mutable preview state') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT apply_historical_import_v3(jsonb_set(payload,'{batch_reference}','"changed"'),preview->>'preview_hash',client_key) FROM historical_fixture$q$,
 '22023','idempotency_payload_conflict','key with changed payload refused');
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM stock_movements WHERE product_id=f.product AND movement_type='sale'),1,'replay has no duplicate stock') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT throws_ok($q$UPDATE orders SET status='paid' WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)$q$,
 'P0003','financial_import_requires_dedicated_workflow','ordinary update cannot trigger a second revenue journal');
INSERT INTO historical_tap(result) SELECT throws_ok($q$UPDATE orders SET financial_import_document_id=NULL WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)$q$,
 'P0003','financial_import_marker_immutable','financial marker cannot be removed');
INSERT INTO historical_tap(result) SELECT throws_ok($q$INSERT INTO order_payments(order_id,method,amount) SELECT entity_id,'cash',80 FROM historical_test_documents$q$,
 'P0003','financial_import_requires_dedicated_workflow','ordinary payment cannot bypass the source allocation ledger');
SELECT set_config('breakery.historical_import_run',(result->>'run_id'),true) FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT throws_ok($q$UPDATE orders SET total=1 WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)$q$,
 'P0003','financial_import_requires_dedicated_workflow','forged GUC for completed run is not an authority');
SELECT set_config('breakery.historical_import_run','',true);
-- Meme facture, nouveau paiement source : aucun nouveau revenu ni stock.
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(payload,'{batch_reference}','"sales-2"'),'{payments}',jsonb_build_array(
 jsonb_build_object('source_reference','PAY-2','source_sha256',repeat('a',64),'source_row',4,'reconciled',true,'payment_date','2097-02-03',
  'amount',80,'method','card','allocations',jsonb_build_array(jsonb_build_object('document_reference','SALE-1','amount',80))))),client_key=gen_random_uuid();
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM historical_test_documents),1,'later settlement reuses source document');
INSERT INTO historical_tap(result) SELECT is((SELECT status::text FROM orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),'paid','final payment marks invoice paid');
INSERT INTO historical_tap(result) SELECT is((SELECT paid_at::date FROM orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),date '2097-02-03','last actual payment determines paid day');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='1131' AND j.metadata->>'financial_import_run_id' IN (SELECT id::text FROM historical_test_runs)),0::numeric,'settlements extinguish exact AR');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='1116' AND j.metadata->>'financial_import_run_id'=f.result->>'run_id'),80::numeric,'card receipt uses card clearing mapping') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.product),9::numeric,'later settlement never consumes stock again') FROM historical_fixture f;
-- Achats : paiement avant reception, compte fournisseur debiteur temporaire.
UPDATE historical_fixture SET client_key=gen_random_uuid(),payload=jsonb_set(jsonb_set(jsonb_set(payload,'{kind}','"purchases"'),'{batch_reference}','"purchase-1"'),
 '{documents}',jsonb_build_array(jsonb_build_object('source_reference','PO-1','source_sha256',repeat('a',64),'source_row',5,'reconciled',true,
 'document_date','2097-01-10','document_timestamp','2097-01-10T11:22:33+08:00','document_time_precision','timestamp',
 'receipt_date','2097-01-24','supplier_id',supplier,'net_amount',98,'tax_amount',10,'total_amount',108,'discount_amount',0,
 'stock_reconciled',true,'stock_basis','source_receipt','lines',jsonb_build_array(jsonb_build_object('source_reference','PO-L1','product_id',raw_product,
 'quantity',5,'unit','kg','received_quantity',3.6,'received_unit','kg','line_total',108,'invoice_unit_cost',19.6,'invoice_net_amount',98,
 'acquisition_amount',108,'reconciled',true)))));
UPDATE historical_fixture SET payload=jsonb_set(payload,'{payments}',jsonb_build_array(jsonb_build_object('source_reference','PO-PAY-1',
 'source_sha256',repeat('a',64),'source_row',6,'reconciled',true,'payment_date','2097-01-16','amount',108,'method','transfer',
 'allocations',jsonb_build_array(jsonb_build_object('document_reference','PO-1','amount',108)))));
INSERT INTO historical_payloads SELECT 'purchase',payload FROM historical_fixture;
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'purchase preview accepts real prepayment and measured net receipt') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT received_date FROM purchase_orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),date '2097-01-24','actual receipt date retained');
INSERT INTO historical_tap(result) SELECT is((SELECT order_date FROM purchase_orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),date '2097-01-10','actual order date retained');
INSERT INTO historical_tap(result) SELECT is((SELECT created_at FROM purchase_orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents)),timestamptz '2097-01-10 11:22:33+08',
 'purchase header preserves known source timestamp');
INSERT INTO historical_tap(result) SELECT is((SELECT i.created_at FROM purchase_order_items i JOIN purchase_orders p ON p.id=i.po_id WHERE p.financial_import_document_id IN (SELECT id FROM historical_test_documents)),
 timestamptz '2097-01-10 11:22:33+08','purchase lines preserve same known source timestamp');
INSERT INTO historical_tap(result) SELECT is((SELECT paid_at::date FROM purchase_payments WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents))),date '2097-01-16','actual bank debit date retained');
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.raw_product),13.6::numeric,'5 kg billed credits 3.6 kg net once') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT round(quantity*unit_cost,2) FROM stock_movements WHERE product_id=f.raw_product AND movement_type='purchase'),108::numeric,'nonrecoverable tax included in exact acquisition cost') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT created_at::date FROM stock_movements WHERE product_id=f.raw_product AND movement_type='purchase'),date '2097-01-24','purchase ledger date fixed before append') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM purchase_payments WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE financial_import_document_id IN (SELECT id FROM historical_test_documents))),1,'no cash autopayment duplicates real source transfer');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(i.subtotal) FROM purchase_order_items i JOIN purchase_orders p ON p.id=i.po_id WHERE p.financial_import_document_id IN (SELECT id FROM historical_test_documents)),98::numeric,
 'native generated invoice line subtotal preserves exact net header');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='2141' AND j.metadata->>'financial_import_run_id'=f.result->>'run_id' AND j.entry_date<date '2097-01-24'),108::numeric,'AP is temporarily debited by actual prepayment') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='2141' AND j.metadata->>'financial_import_run_id'=f.result->>'run_id'),0::numeric,'receipt clears prepayment without invented advance account') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT ok((SELECT bool_and(consumed) FROM historical_test_stock_effects),'every planned stock effect consumed exactly once');
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM notification_outbox),notifications_before,'purchase/WAC replay produces no notification side effects') FROM historical_fixture;
\ir helpers/historical_import_cases.sql
SELECT result FROM historical_tap ORDER BY id;
SELECT * FROM finish();
ROLLBACK;
