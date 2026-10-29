BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
\ir helpers/historical_import.sql
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{stock_mode}','"financial_only"'),
 '{documents,0,stock_mode}','"financial_only"'),'{allow_supplier_prepayments}','true'),'{payments,0,supplier_prepayment}','true');
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(payload,'{payments,0,payment_date}','"2097-01-09"'),'{payments,0,payment_timestamp}','"2097-01-09T17:18:19+08:00"');
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(payload)->'errors' @> '[{"code":"payment_precedes_document"}]','sales cannot opt into supplier advances') FROM historical_fixture;
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(payload,'{kind}','"purchases"'),'{documents}',jsonb_build_array(
 jsonb_build_object('source_reference','PO-ADV','source_sha256',repeat('a',64),'source_row',5,'reconciled',true,'stock_mode','financial_only',
 'document_date','2097-01-10','receipt_date','2097-01-24','supplier_id',supplier,'net_amount',98,'tax_amount',10,'total_amount',108,'discount_amount',0,
 'lines',jsonb_build_array(jsonb_build_object('source_reference','PO-L1','product_id',raw_product,'quantity',5,'unit','kg',
 'received_quantity',3.6,'received_unit','kg','line_total',108,'invoice_unit_cost',19.6,'invoice_net_amount',98,'acquisition_amount',108,'reconciled',true))))),
 '{payments,0,allocations}',jsonb_build_array(jsonb_build_object('document_reference','PO-ADV','amount',108)));
UPDATE historical_fixture SET payload=jsonb_set(payload,'{payments,0,amount}','108');
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(payload-'allow_supplier_prepayments')->'errors' @> '[{"code":"payment_precedes_document"}]','batch opt-in is required') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(payload #- '{payments,0,supplier_prepayment}')->'errors' @> '[{"code":"payment_precedes_document"}]','payment opt-in is required') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(jsonb_set(payload,'{allow_supplier_prepayments}','"true"'))->'errors' @> '[{"code":"payment_precedes_document"}]','string true cannot enable supplier advances') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(jsonb_set(jsonb_set(payload,'{stock_mode}','"legacy"'),'{documents,0,stock_mode}','"legacy"'))->'errors' @> '[{"code":"payment_precedes_document"}]','legacy stock import keeps its date gate') FROM historical_fixture;
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'explicit financial purchase accepts real advance date') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(preview->'supplier_prepayment_count','1'::jsonb,'preview counts one actual advance') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
INSERT INTO historical_tap(result) SELECT is(result->'supplier_prepayment_count','1'::jsonb,'result retains advance count') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(apply_historical_import_v3(payload,preview->>'preview_hash',client_key)->'idempotent_replay','true'::jsonb,'advance replay returns original result') FROM historical_fixture;
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT paid_at FROM purchase_payments WHERE purchase_order_id=(SELECT entity_id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),
 timestamptz '2097-01-09 17:18:19+08','native payment retains actual advance timestamp') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT source_payload->'supplier_prepayment' FROM historical_import_payments WHERE run_id=(f.result->>'run_id')::uuid),'true'::jsonb,'immutable payment source retains advance flag') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT payload->'supplier_prepayment_count' FROM audit_logs WHERE action='historical_import.applied' AND entity_id=(f.result->>'run_id')::uuid),'1'::jsonb,'audit explicitly counts actual advance') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
 WHERE a.code='2141' AND j.metadata->>'financial_import_run_id'=f.result->>'run_id' AND j.entry_date=date '2097-01-09'),108::numeric,'actual advance debits existing AP on actual date') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
 WHERE a.code='2141' AND j.metadata->>'financial_import_run_id'=f.result->>'run_id'),0::numeric,'receipt clears exact advance without new account') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM journal_entries WHERE metadata->>'financial_import_run_id'=f.result->>'run_id'),2::bigint,'one purchase JE and one advance JE without duplicate') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT ok((SELECT bool_and(total_debit=total_credit) FROM journal_entries WHERE metadata->>'financial_import_run_id'=f.result->>'run_id'),'all advance journals balance') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM historical_import_stock_effects WHERE run_id=(f.result->>'run_id')::uuid),0::bigint,'supplier advance creates no stock effect') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.raw_product),10::numeric,'supplier advance and receipt do not alter physical stock') FROM historical_fixture f;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT jsonb_build_object('executed',(SELECT count(*) FROM historical_tap),
 'failures',(SELECT coalesce(jsonb_agg(result),'[]') FROM historical_tap WHERE result LIKE 'not ok%'),
 'tap_finish',(SELECT coalesce(jsonb_agg(result),'[]') FROM finish() result)) AS test_result;
ROLLBACK;
