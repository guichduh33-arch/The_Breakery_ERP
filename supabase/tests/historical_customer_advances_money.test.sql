BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
\ir helpers/historical_customer_advances_fixture.sql
\ir helpers/historical_customer_advances.sql
CREATE TEMP TABLE ca_baseline AS SELECT (SELECT count(*) FROM stock_movements) stock_n,(SELECT count(*) FROM display_movements) display_n;
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v4(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'two dated advances reconcile') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(preview->'customer_advance_count','2'::jsonb,'preview counts two advances') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(preview->'customer_advance_amount','200000'::jsonb,'preview preserves actual advance total') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(preview->'stock_effects','[]'::jsonb,'preview plans no stock') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v4(payload,preview->>'preview_hash',client_key);
INSERT INTO historical_tap(result) SELECT is(apply_historical_import_v4(payload,preview->>'preview_hash',client_key)->'idempotent_replay','true'::jsonb,'replay reuses original result') FROM historical_fixture;
RESET ROLE;
CREATE TEMP VIEW ca_lines AS SELECT j.entry_date,j.reference_type,j.reference_id,j.id journal_id,a.code,l.debit,l.credit
 FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id=j.id JOIN accounts a ON a.id=l.account_id
 JOIN historical_fixture f ON j.metadata->>'financial_import_run_id'=f.result->>'run_id';
INSERT INTO historical_tap(result) SELECT is((SELECT sum(credit-debit) FROM ca_lines WHERE code='2230' AND entry_date<=date '2097-01-25'),200000::numeric,'liability 200k on actual receipt day');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(credit-debit) FROM ca_lines WHERE code='2230' AND entry_date<=date '2097-01-26'),100000::numeric,'liability 100k after first application');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(credit-debit) FROM ca_lines WHERE code='2230' AND entry_date<=date '2097-01-27'),0::numeric,'liability extinguished after second application');
INSERT INTO historical_tap(result) SELECT is((SELECT coalesce(sum(debit-credit),0) FROM ca_lines WHERE code='1132' AND entry_date<=date '2097-01-25'),0::numeric,'no negative AR before invoices');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(debit-credit) FROM ca_lines WHERE code='1132'),0::numeric,'invoice AR is fully settled');
INSERT INTO historical_tap(result) SELECT is((SELECT sum(debit-credit) FROM ca_lines WHERE code='1112'),200000::numeric,'real bank receipt is posted once');
INSERT INTO historical_tap(result) SELECT is((SELECT count(DISTINCT journal_id) FROM ca_lines),6::bigint,'two sales receipts and applications produce six journals');
INSERT INTO historical_tap(result) SELECT ok(NOT EXISTS(SELECT journal_id FROM ca_lines GROUP BY journal_id HAVING sum(debit)<>sum(credit)),'all journals balance');
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM b2b_payments p JOIN historical_import_allocations a ON a.native_payment_id=p.id
 JOIN historical_import_documents d ON d.id=a.document_id WHERE d.run_id=(f.result->>'run_id')::uuid AND p.paid_at::date=date '2097-01-25'),2::bigint,'native receipts keep actual date') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM orders o JOIN historical_import_documents d ON d.id=o.financial_import_document_id
 WHERE d.run_id=(f.result->>'run_id')::uuid AND o.paid_at::date=d.document_date AND o.status='paid'),2::bigint,'invoice settlement dates are application dates') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM historical_import_allocations a JOIN historical_import_documents d ON d.id=a.document_id
 JOIN journal_entries j ON j.id=a.journal_entry_id WHERE d.run_id=(f.result->>'run_id')::uuid AND j.reference_type='customer_advance_application'),2::bigint,'allocation links actual clearing journal') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT b2b_current_balance FROM customers WHERE id=corporate),0::numeric,'native customer balance reconciles') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM historical_import_payments WHERE run_id=(f.result->>'run_id')::uuid AND source_payload->'customer_advance'='true'::jsonb),2::bigint,'immutable sources retain advance identity and dates') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is(result->'customer_advance_amount','200000'::jsonb,'result retains advance amount') FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is((SELECT payload->'customer_advance_count' FROM audit_logs WHERE action='historical_import.applied' AND entity_id=(f.result->>'run_id')::uuid),'2'::jsonb,'audit retains advance count') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM stock_movements),stock_n,'no global stock movement') FROM ca_baseline;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM display_movements),display_n,'no display movement') FROM ca_baseline;
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=product),10::numeric,'physical stock unchanged') FROM historical_fixture;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT result FROM historical_tap ORDER BY id;
SELECT * FROM finish();
ROLLBACK;
