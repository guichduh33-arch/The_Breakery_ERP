BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
\ir helpers/historical_import.sql
CREATE TEMP TABLE financial_baseline AS SELECT
 (SELECT count(*) FROM stock_movements) stock_count,
 (SELECT count(*) FROM display_movements) display_count,
 (SELECT count(*) FROM production_records) production_count;
UPDATE products SET current_stock=0,is_display_item=true WHERE id=(SELECT product FROM historical_fixture);
INSERT INTO display_stock(product_id,quantity) SELECT product,0 FROM historical_fixture
 ON CONFLICT(product_id) DO UPDATE SET quantity=0;
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(payload,'{stock_mode}','"financial_only"'),
 '{documents,0,stock_mode}','"financial_only"'),'{documents,0,lines,0,name_snapshot}','"Original item - HOT, extra syrup"');
UPDATE historical_fixture SET payload=(payload #- '{documents,0,stock_reconciled}') #- '{documents,0,stock_basis}';
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v4(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'financial sale accepts zero global and display stock without stock reconciliation') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(preview->'stock_effects','[]'::jsonb,'financial sale plans no stock effects') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(preview->>'stock_basis','deferred_to_opening_opname','preview states stock is deferred') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(preview->'source_options_not_resolved_for_stock','true'::jsonb,'preview does not claim options are reconciled for stock') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(preview_historical_import_v4(payload #- '{documents,0,stock_mode}')->'errors'
 @> '[{"code":"document_stock_mode_mismatch"}]','financial mode must be explicit on every document') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(preview_historical_import_v4(jsonb_set(payload,'{stock_mode}','"legacy"'))->'errors'
 @> '[{"code":"document_stock_mode_mismatch"}]','mixed legacy and financial documents are refused') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v4(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.product),0::numeric,'sale leaves global stock at zero') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT quantity FROM display_stock WHERE product_id=f.product),0::numeric,'sale leaves display stock at zero') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT cost_price FROM products WHERE id=f.product),20::numeric,'sale leaves WAC unchanged') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM historical_import_stock_effects WHERE run_id=(f.result->>'run_id')::uuid),0::bigint,'no stock effect registry rows are created') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT name_snapshot FROM order_items WHERE order_id=(SELECT entity_id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),
 'Original item - HOT, extra syrup','source options text is retained in native sale line') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT source_payload->>'stock_mode' FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid),
 'financial_only','immutable source registry retains document stock mode') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT total FROM orders WHERE financial_import_document_id=(SELECT id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),110::numeric,'native sale retains exact source total') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT sum(amount) FROM historical_import_allocations WHERE document_id=(SELECT id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),30::numeric,'real partial payment remains allocated') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT entry_date FROM journal_entries WHERE reference_type='pos_outstanding' AND metadata->>'financial_import_run_id'=f.result->>'run_id'),date '2097-01-10','sale JE keeps source document date') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM journal_entries WHERE metadata->>'financial_import_run_id'=f.result->>'run_id'),2::bigint,'one sale JE and one actual payment JE') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT payload->>'stock_mode' FROM audit_logs WHERE action='historical_import.applied' AND entity_id=(f.result->>'run_id')::uuid),'financial_only','run audit records financial mode') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT payload->'stock_deferred' FROM audit_logs WHERE action='historical_import.document' AND entity_id=(SELECT id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),
 'true'::jsonb,'document audit explicitly records deferred stock') FROM historical_fixture f;
SET LOCAL ROLE authenticated;
INSERT INTO historical_tap(result) SELECT is(apply_historical_import_v4(payload,preview->>'preview_hash',client_key)->'idempotent_replay','true'::jsonb,'financial replay returns the first result') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(preview_historical_import_v4(jsonb_set(jsonb_set(jsonb_set(payload,'{stock_mode}','"legacy"'),'{documents,0,stock_mode}','"legacy"'),'{batch_reference}','"switch-mode"'))->'errors'
 @> '[{"code":"document_source_conflict"}]','same document cannot later reimport in stock mode') FROM historical_fixture;
RESET ROLE;
-- Groupes requis, recettes et choix courants ne decrivent pas les options source historiques.
INSERT INTO product_modifiers(product_id,group_name,group_required,group_type,option_label,price_adjustment,ingredients_to_deduct)
 SELECT product,'Current required option',true,'single_select','Current option',0,'[]' FROM historical_fixture;
UPDATE products SET track_inventory=false,is_display_item=false,deduct_stock=true WHERE id=(SELECT product FROM historical_fixture);
UPDATE historical_fixture SET client_key=gen_random_uuid(),payload=jsonb_set(jsonb_set(jsonb_set(payload,'{batch_reference}','"financial-no-recipe"'),
 '{documents,0,source_reference}','"SALE-NO-RECIPE"'),'{payments}','[]');
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v4(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'missing current recipe and required option do not invent historical stock') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(preview_historical_import_v4(jsonb_set(payload,'{documents,0,lines,0,modifier_ids}',
 '["00000000-0000-0000-0000-000000000001"]'))->'errors' @> '[{"code":"modifier_not_available_or_duplicate"}]','supplied modifier UUID must really exist') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v4(payload,preview->>'preview_hash',client_key);
RESET ROLE;
UPDATE products SET product_type='combo' WHERE id=(SELECT product FROM historical_fixture);
UPDATE historical_fixture SET client_key=gen_random_uuid(),payload=jsonb_set(jsonb_set(payload,'{batch_reference}','"financial-combo"'),'{documents,0,source_reference}','"SALE-COMBO"');
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v4(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'confirmed combo SKU can retain source identity without invented components') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v4(payload,preview->>'preview_hash',client_key);
RESET ROLE;
-- Achats financiers : facture, reception datee, paiement et JE reels ; aucun mouvement/WAC.
UPDATE products SET current_stock=0 WHERE id=(SELECT raw_product FROM historical_fixture);
UPDATE historical_fixture SET client_key=gen_random_uuid(),payload=jsonb_set(jsonb_set(jsonb_set(payload,'{kind}','"purchases"'),'{batch_reference}','"financial-purchase"'),
 '{documents}',jsonb_build_array(jsonb_build_object('source_reference','PO-FIN','source_sha256',repeat('a',64),'source_row',5,'reconciled',true,
 'stock_mode','financial_only','document_date','2097-01-10','receipt_date','2097-01-24','supplier_id',supplier,
 'net_amount',98,'tax_amount',10,'total_amount',108,'discount_amount',0,'lines',jsonb_build_array(jsonb_build_object('source_reference','PO-L1','product_id',raw_product,
 'quantity',5,'unit','kg','received_quantity',3.6,'received_unit','kg','line_total',108,'invoice_unit_cost',19.6,'invoice_net_amount',98,'acquisition_amount',108,'reconciled',true)))));
UPDATE historical_fixture SET payload=jsonb_set(payload,'{payments}',jsonb_build_array(jsonb_build_object('source_reference','PO-PAY-FIN',
 'source_sha256',repeat('a',64),'source_row',6,'reconciled',true,'payment_date','2097-01-16','amount',108,'method','transfer',
 'allocations',jsonb_build_array(jsonb_build_object('document_reference','PO-FIN','amount',108)))));
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v4(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'financial purchase accepts real payment before receipt') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(preview->'stock_effects','[]'::jsonb,'financial purchase plans no receipt stock') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(preview_historical_import_v4(jsonb_set(payload,'{payments,0,payment_date}','"2097-01-09"'))->'errors'
 @> '[{"code":"payment_precedes_document"}]','payment before document remains blocked pending owner arbitration') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v4(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.raw_product),0::numeric,'financial purchase does not initialize physical stock') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT cost_price FROM products WHERE id=f.raw_product),20::numeric,'financial purchase does not initialize WAC') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT paid_at::date FROM purchase_payments WHERE purchase_order_id=(SELECT entity_id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),date '2097-01-16','actual purchase payment date survives') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT received_date FROM purchase_orders WHERE financial_import_document_id=(SELECT id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),date '2097-01-24','actual receipt date survives') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT sum(i.subtotal) FROM purchase_order_items i WHERE po_id=(SELECT entity_id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),98::numeric,'native purchase invoice amount survives') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='2141' AND j.metadata->>'financial_import_run_id'=f.result->>'run_id'),0::numeric,'real purchase and payment extinguish exact AP') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT ok((SELECT bool_and(total_debit=total_credit) FROM journal_entries j WHERE j.metadata->>'financial_import_run_id' IN
 (SELECT id::text FROM historical_import_runs WHERE source_system=f.payload->>'source_system')),'all financial journals are balanced') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM stock_movements),stock_count,'financial imports append no global movement') FROM financial_baseline;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM display_movements),display_count,'financial imports append no display movement') FROM financial_baseline;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM production_records),production_count,'financial imports create no production') FROM financial_baseline;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM notification_outbox),notifications_before,'financial imports emit no operational notifications') FROM historical_fixture;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT result FROM historical_tap ORDER BY id;
SELECT * FROM finish();
ROLLBACK;
