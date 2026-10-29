-- Refus, atomie, roles et etats supplementaires de la reprise.
UPDATE historical_fixture SET payload=(SELECT payload FROM historical_payloads WHERE label='sale');
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{batch_reference}','"edge-sales"'),
 '{documents,0,source_reference}','"SALE-EDGE"'),'{payments,0,source_reference}','"PAY-EDGE"'),
 '{payments,0,allocations,0,document_reference}','"SALE-EDGE"'),client_key=gen_random_uuid();
INSERT INTO historical_payloads SELECT 'edge-sale',payload FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(jsonb_set(payload,'{documents,0,customer_treatment}',
 '"owner_company_benefit"'))->'errors' @> '[{"code":"owner_accounting_pending"}]','Owner remains explicitly pending') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(jsonb_set(payload,'{documents,0,tax_amount}','null'))->'errors'
 @> '[{"code":"invalid_document_amounts"}]','missing historical tax is never zero-filled') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(jsonb_set(payload,'{documents,0,stock_reconciled}','false'))->'errors'
 @> '[{"code":"stock_basis_reconciliation_required"}]','recipe estimates require explicit reconciled basis') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(jsonb_set(payload,'{documents,0,lines,0,quantity}','0.000001'))->'errors'
 @> '[{"code":"sale_line_not_representable"}]','quantity cannot be silently truncated to native precision') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(jsonb_set(payload,'{documents,0,lines,0,unit}','"kg"'))->'errors'
 @> '[{"code":"unit_or_recipe_resolution_failed"}]','missing conversion never falls back to raw quantity') FROM historical_fixture;
UPDATE fiscal_periods SET status='closed' WHERE period_start='2097-01-01';
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(payload)->'errors' @> '[{"code":"fiscal_period_closed_or_missing"}]',
 'closed ticket period blocks even if payment period is open') FROM historical_fixture;
UPDATE fiscal_periods SET status='open' WHERE period_start='2097-01-01';
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
UPDATE products SET min_stock_threshold=1 WHERE id=(SELECT product FROM historical_fixture);
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT apply_historical_import_v3(payload,preview->>'preview_hash',client_key) FROM historical_fixture$q$,
 '22023','historical_preview_stale','changed dependency invalidates review hash');
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM historical_test_runs),3,'stale preview inserts no run');
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT apply_historical_import_v3(jsonb_set(payload,'{documents,0,reconciled}','false'),preview->>'preview_hash',client_key) FROM historical_fixture$q$,
 '22023','historical_import_not_reconciled','unreconciled document rejects whole batch');
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM historical_test_documents),2,'invalid batch inserts no partial document');
UPDATE user_sessions SET ended_at=now() WHERE id=(auth.jwt()->>'session_id')::uuid;
SET LOCAL ROLE authenticated;
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT preview_historical_import_v3(payload) FROM historical_fixture$q$,
 'P0003','active_pin_session_required','ended PIN session cannot preview');
RESET ROLE;
SELECT pg_temp.authenticate_pin(auth_id) FROM historical_fixture;
UPDATE user_sessions SET permissions_snapshot=array_remove(permissions_snapshot,'accounting.je.create_manual') WHERE id=(auth.jwt()->>'session_id')::uuid;
SET LOCAL ROLE authenticated;
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT preview_historical_import_v3(payload) FROM historical_fixture$q$,
 'P0003','permission_denied','session snapshot must contain financial permission');
RESET ROLE;
SELECT pg_temp.authenticate_pin(auth_id) FROM historical_fixture;
-- Split tender : deux vrais encaissements, aucun fallback cash.
UPDATE historical_fixture SET payload=jsonb_set(payload,'{payments}',(payload->'payments')||jsonb_build_array(
 jsonb_build_object('source_reference','PAY-SPLIT','source_sha256',repeat('a',64),'source_row',9,'reconciled',true,'payment_date','2097-02-02',
 'amount',80,'method','card','allocations',jsonb_build_array(jsonb_build_object('document_reference','SALE-EDGE','amount',80)))));
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::int FROM order_payments WHERE order_id=(SELECT entity_id FROM historical_test_documents WHERE source_reference='SALE-EDGE')),2,
 'split tender preserves two source payments');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(amount) FROM order_payments WHERE order_id=(SELECT entity_id FROM historical_test_documents WHERE source_reference='SALE-EDGE')),110::numeric,
 'split tender sums exactly to invoice');
-- Corporate : meme taxe ticket, compte1132 et allocations B2B natives exactes.
UPDATE historical_fixture SET payload=(SELECT payload FROM historical_payloads WHERE label='edge-sale'),client_key=gen_random_uuid();
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{batch_reference}','"corporate"'),
 '{documents,0,source_reference}','"CORP-1"'),'{documents,0,customer_treatment}','"corporate"'),'{documents,0,customer_id}',to_jsonb(corporate)),
 '{payments,0,source_reference}','"CORP-PAY-1"'),'{payments,0,allocations,0,document_reference}','"CORP-1"');
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT b2b_current_balance FROM customers WHERE id=f.corporate),80::numeric,'corporate balance reflects only actual payment') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='1132' AND j.metadata->>'financial_import_run_id'=f.result->>'run_id'),80::numeric,
 'corporate recognition and collection use1132') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT amount_applied FROM b2b_payment_allocations WHERE invoice_id=(SELECT entity_id FROM historical_test_documents WHERE source_reference='CORP-1')),30::numeric,
 'corporate allocation is source-exact rather than FIFO');
-- Absence de representabilite au centime : refus, aucune tolerance.
UPDATE historical_fixture SET payload=(SELECT payload FROM historical_payloads WHERE label='purchase');
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{batch_reference}','"purchase-edge"'),'{documents,0,source_reference}','"PO-EDGE"'),
 '{payments,0,source_reference}','"PO-EDGE-PAY"'),'{payments,0,allocations,0,document_reference}','"PO-EDGE"');
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{documents,0,net_amount}','100'),
 '{documents,0,total_amount}','110'),'{documents,0,lines,0,line_total}','110'),'{documents,0,lines,0,acquisition_amount}','110'),
 '{payments,0,amount}','110'),'{payments,0,allocations,0,amount}','110');
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(payload,'{documents,0,lines,0,invoice_unit_cost}','20'),'{documents,0,lines,0,invoice_net_amount}','100');
INSERT INTO historical_tap(result) SELECT is(_historical_import_plan_v3(payload)->'errors','[]'::jsonb,
 'approved rounded stock unit cost retains exact invoice net and total') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is((_historical_import_plan_v3(payload)->'stock_effects'->0->>'unit_cost_representation_delta')::numeric,0.02::numeric,
 'every stock unit cost representation delta is explicit in preview') FROM historical_fixture;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload),client_key=gen_random_uuid();
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
INSERT INTO historical_tap(result) SELECT is((SELECT (s.metadata->>'unit_cost_representation_delta')::numeric FROM stock_movements s
 JOIN historical_test_stock_effects e ON e.movement_id=s.id WHERE e.run_id=(f.result->>'run_id')::uuid),0.02::numeric,
 'representation delta is stamped before append to stock ledger') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT total FROM goods_receipt_notes WHERE po_id=(SELECT entity_id FROM historical_test_documents WHERE source_reference='PO-EDGE')),110::numeric,
 'unit cost rounding changes no receipt invoice amount');
INSERT INTO historical_tap(result) SELECT ok(_historical_import_plan_v3(jsonb_set(jsonb_set(jsonb_set(payload,'{documents,0,source_reference}','"BAD-INVOICE"'),
 '{payments,0,allocations,0,document_reference}','"BAD-INVOICE"'),'{documents,0,lines,0,invoice_unit_cost}','19.99'))->'errors'
 @> '[{"code":"purchase_invoice_line_not_representable"}]','native invoice unit cost cannot silently alter source line amount') FROM historical_fixture;
-- Prix non fini au centime : 300 oeufs / 550000, sans retoucher la quantite ou la facture.
UPDATE historical_fixture SET payload=(SELECT payload FROM historical_payloads WHERE label='purchase'),client_key=gen_random_uuid();
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{batch_reference}','"egg-price"'),
 '{documents,0,source_reference}','"PO-EGG"'),'{documents,0,net_amount}','550000'),'{documents,0,tax_amount}','0'),'{documents,0,total_amount}','550000');
UPDATE historical_fixture SET payload=jsonb_set(payload,'{documents,0,lines}',jsonb_build_array(jsonb_build_object('source_reference','EGG-L1',
 'product_id',product,'quantity',300,'unit','pcs','received_quantity',300,'received_unit','pcs','line_total',550000,'invoice_net_amount',550000,
 'acquisition_amount',550000,'reconciled',true)));
UPDATE historical_fixture SET payload=jsonb_set(payload,'{payments}','[]');
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'300 units with550000 exact invoice need no artificial adjustment line') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
INSERT INTO historical_tap(result) SELECT is((SELECT i.subtotal FROM purchase_order_items i JOIN purchase_orders p ON p.id=i.po_id WHERE p.import_reference=(SELECT payload->>'source_system' FROM historical_fixture)||':PO-EGG'),550000::numeric,
 'expanded unit price preserves exact generated line subtotal');
INSERT INTO historical_tap(result) SELECT is((SELECT i.quantity FROM purchase_order_items i JOIN purchase_orders p ON p.id=i.po_id WHERE p.import_reference=(SELECT payload->>'source_system' FROM historical_fixture)||':PO-EGG'),300::numeric,
 'unit price precision never changes billed quantity');
INSERT INTO historical_tap(result) SELECT is((SELECT numeric_scale::integer FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_movements' AND column_name='unit_cost'),2,
 'stock ledger unit cost precision stays unchanged');
INSERT INTO historical_tap(result) SELECT is(_historical_import_timestamp_v1('"2097-01-10T23:59:00Z"',date '2097-01-10','timestamp'),NULL::timestamptz,
 'timestamp must match real Makassar business date');
INSERT INTO historical_tap(result) SELECT is(_historical_import_timestamp_v1(NULL,date '2097-01-10','timestamp'),NULL::timestamptz,
 'known timestamp precision cannot be claimed without source timestamp');
INSERT INTO historical_tap(result) SELECT is((SELECT time_precision FROM historical_test_payments WHERE source_reference='PAY-2'),'day',
 'source day-only receipt retains day precision without an invented observed time');
-- Les groupes requis et suppléments exigent leur identité explicite.
-- Bornes natives numeric(12,2) : refus au preview et aucune ecriture partielle.
UPDATE historical_fixture SET payload=(SELECT payload FROM historical_payloads WHERE label='edge-sale'),client_key=gen_random_uuid();
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{batch_reference}','"price-edge"'),
 '{documents,0,source_reference}','"PRICE-EDGE"'),'{payments,0,source_reference}','"PRICE-PAY"'),'{payments,0,allocations,0,document_reference}','"PRICE-EDGE"');
UPDATE historical_fixture SET payload=jsonb_set(payload,'{documents,0,lines,0,unit_price}','10000000000');
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
INSERT INTO historical_tap(result) SELECT ok(preview->'errors' @> '[{"code":"sale_price_not_representable"}]',
 'preview rejects unit price at native numeric12,2 overflow boundary') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT apply_historical_import_v3(payload,preview->>'preview_hash',client_key) FROM historical_fixture$q$,
 '22023','historical_import_not_reconciled','unrepresentable source unit price never reaches order insert');
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(payload,'{documents,0,lines,0,unit_price}','110'),'{documents,0,lines,0,addon_amount}','10000000000');
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
INSERT INTO historical_tap(result) SELECT ok(preview->'errors' @> '[{"code":"sale_price_not_representable"}]',
 'preview rejects addon amount at native numeric12,2 overflow boundary') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT apply_historical_import_v3(payload,preview->>'preview_hash',client_key) FROM historical_fixture$q$,
 '22023','historical_import_not_reconciled','unrepresentable addon never reaches order insert');
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::integer FROM historical_test_documents WHERE source_reference='PRICE-EDGE'),0,
 'price boundary refusals leave no historical document');
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::integer FROM orders WHERE import_reference=(SELECT payload->>'source_system' FROM historical_fixture)||':PRICE-EDGE'),0,
 'price boundary refusals leave no native order');
-- Vitrine : solde physique de fixture, double ledger date a l'INSERT et pas de bypass.
UPDATE historical_fixture SET payload=(SELECT payload FROM historical_payloads WHERE label='edge-sale'),client_key=gen_random_uuid();
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{batch_reference}','"display-sale"'),
 '{documents,0,source_reference}','"DISPLAY-1"'),'{payments,0,source_reference}','"DISPLAY-PAY"'),'{payments,0,allocations,0,document_reference}','"DISPLAY-1"');
UPDATE products SET is_display_item=true WHERE id=(SELECT product FROM historical_fixture);
UPDATE display_stock SET quantity=0 WHERE product_id=(SELECT product FROM historical_fixture);
UPDATE business_config SET allow_negative_stock=true WHERE id=1;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
INSERT INTO historical_tap(result) SELECT ok(preview->'errors' @> '[{"code":"insufficient_display_stock"}]',
 'historical preview cannot bypass empty display even with negative global stock allowed') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT _record_sale_stock_v1(product,1,gen_random_uuid(),actor,'Fixture empty display','sale','orders','pcs',true) FROM historical_fixture$q$,
 'P0002',NULL,'canonical sale helper still refuses empty display with allow_negative true');
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT apply_historical_import_v3(payload,preview->>'preview_hash',client_key) FROM historical_fixture$q$,
 '22023','historical_import_not_reconciled','empty display cannot be imported by the dedicated RPC');
UPDATE business_config SET allow_negative_stock=false WHERE id=1;
UPDATE display_stock SET quantity=2 WHERE product_id=(SELECT product FROM historical_fixture);
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT quantity FROM display_stock WHERE product_id=f.product),1::numeric,
 'canonical sale decrements actual display fixture quantity exactly once') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT d.created_at FROM display_movements d JOIN historical_test_stock_effects e ON e.display_movement_id=d.id
 WHERE e.run_id=(f.result->>'run_id')::uuid),timestamptz '2097-01-10 09:12:34+08','display ledger preserves exact source sale timestamp before append') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT ok((SELECT d.created_at=s.created_at AND e.time_precision='timestamp' FROM historical_test_stock_effects e
 JOIN display_movements d ON d.id=e.display_movement_id JOIN stock_movements s ON s.id=e.movement_id WHERE e.run_id=(f.result->>'run_id')::uuid),
 'display and global stock share one prevalidated effect and source precision') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is(apply_historical_import_v3(payload,preview->>'preview_hash',client_key)->'idempotent_replay','true'::jsonb,
 'display sale replay returns first result') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::integer FROM display_movements d JOIN historical_test_stock_effects e ON e.display_movement_id=d.id
 WHERE e.run_id=(f.result->>'run_id')::uuid),1,'replay never appends a second display movement') FROM historical_fixture f;
-- Un effet deja consomme ne permet pas un second miroir, meme dans un contexte prive valide de fixture.
UPDATE historical_import_runs SET status='applying' WHERE id=(SELECT (result->>'run_id')::uuid FROM historical_fixture);
SELECT set_config('breakery.historical_import_run',result->>'run_id',true) FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT throws_ok($q$INSERT INTO display_movements(product_id,movement_type,quantity,reference_type,reference_id,created_by)
 SELECT f.product,'sale',-1,'order',d.entity_id,f.actor FROM historical_fixture f JOIN historical_test_documents d ON d.source_reference='DISPLAY-1'$q$,
 'P0002','historical_display_effect_not_planned','consumed historical display effect cannot authorize a second append');
SELECT set_config('breakery.historical_import_run','',true);
UPDATE historical_import_runs SET status='applied' WHERE id=(SELECT (result->>'run_id')::uuid FROM historical_fixture);
DO $$ DECLARE product uuid:=(SELECT f.product FROM historical_fixture f); mid uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid(); BEGIN
 INSERT INTO product_modifiers(id,product_id,group_name,group_required,group_type,option_label,price_adjustment,ingredients_to_deduct)
 VALUES(mid,product,'Temperature',true,'single_select','HOT',0,'[]'),
  (aid,product,'Extra',false,'multi_select','Extra ingredient',10,jsonb_build_array(jsonb_build_object('product_id',(SELECT raw_product FROM historical_fixture),'qty',100,'unit','gr')));
 INSERT INTO historical_payloads VALUES('modifiers',jsonb_build_object('standard',mid,'addon',aid));
END $$;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_modifier_plan_v1(f.product,1,'[]',0,'[]',false)->'errors'
 @> '[{"code":"modifier_group_selection_required"}]','required choice is never guessed') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT ok(_historical_import_modifier_plan_v1(f.product,1,jsonb_build_array(m.payload->'standard'),10,'[]',true)->'errors'
 @> '[{"code":"addon_identity_unresolved"}]','HOT standard choice does not explain billed addon') FROM historical_fixture f,historical_payloads m WHERE m.label='modifiers';
INSERT INTO historical_tap(result) SELECT is(_historical_import_modifier_plan_v1(f.product,1,jsonb_build_array(m.payload->'standard',m.payload->'addon'),10,
 jsonb_build_array(m.payload->'addon'),true)->'errors','[]'::jsonb,'explicit priced addon identity resolves server-side') FROM historical_fixture f,historical_payloads m WHERE m.label='modifiers';
INSERT INTO historical_tap(result) SELECT is((_historical_import_modifier_plan_v1(f.product,2,jsonb_build_array(m.payload->'standard',m.payload->'addon'),10,
 jsonb_build_array(m.payload->'addon'),true)->'effects'->0->>'quantity')::numeric,-0.2::numeric,'modifier ingredients convert grams to base kilograms without fallback')
 FROM historical_fixture f,historical_payloads m WHERE m.label='modifiers';
SET CONSTRAINTS ALL IMMEDIATE;
