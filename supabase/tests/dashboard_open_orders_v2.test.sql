BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
\ir helpers/historical_customer_advances_fixture.sql
CREATE TEMP TABLE dashboard_result(phase text PRIMARY KEY,result jsonb);
CREATE TEMP TABLE dashboard_fixture(label text,id uuid DEFAULT gen_random_uuid(),amount numeric,status order_status,
 held boolean DEFAULT false,legacy boolean DEFAULT false,voided_at timestamptz,created_at timestamptz);
GRANT SELECT,INSERT ON dashboard_result TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO dashboard_result VALUES('before',get_dashboard_open_orders_v2());
RESET ROLE;
-- Reprise financiere reelle sous transaction : elle reste une creance ouverte.
UPDATE historical_fixture SET payload=payload||jsonb_build_object('stock_mode','financial_only','payments','[]'::jsonb,
 'documents',jsonb_build_array(jsonb_build_object('source_reference','DASH-HISTORY','source_sha256',repeat('a',64),'source_row',2,
 'reconciled',true,'document_date','2097-01-10','customer_treatment','retail','customer_id',customer,
 'stock_mode','financial_only','net_amount',100000,'tax_amount',0,'total_amount',100000,'discount_amount',0,
 'tax_source','sales_details_ticket','lines',jsonb_build_array(jsonb_build_object('source_reference','L1','product_id',product,
 'quantity',1,'unit','pcs','unit_price',100000,'line_total',100000,'reconciled',true)))));
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v4(payload);
UPDATE historical_fixture SET result=apply_historical_import_v4(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO dashboard_fixture(label,amount,status,held,legacy,voided_at,created_at) VALUES
 ('old-real',111,'pending_payment',false,false,NULL,now()-interval '90 days'),
 ('draft',222,'draft',false,false,NULL,now()-interval '10 minutes'),
 ('pending',333,'pending_payment',false,false,NULL,now()-interval '5 minutes'),
 ('held',444,'pending_payment',true,false,NULL,now()-interval '60 minutes'),
 ('void-status',555,'voided',false,false,now(),now()-interval '60 minutes'),
 ('paid',666,'paid',false,false,NULL,now()-interval '60 minutes'),
 ('legacy',777,'pending_payment',false,true,NULL,now()-interval '90 days');
WITH session AS (INSERT INTO pos_sessions(opened_by,opening_cash,status) SELECT actor,0,'open' FROM historical_fixture RETURNING id)
INSERT INTO orders(id,order_number,session_id,created_via,order_type,status,total,subtotal,tax_amount,created_at,is_held,is_historical_import,voided_at,voided_by,void_reason)
 SELECT f.id,'DASH-'||f.id,s.id,'pos',CASE WHEN f.label='paid' THEN 'b2b'::order_type ELSE 'take_out'::order_type END,
 f.status,f.amount,f.amount,0,f.created_at,f.held,f.legacy,f.voided_at,
 CASE WHEN f.status='voided' THEN h.actor END,CASE WHEN f.status='voided' THEN 'Fixture void' END
 FROM dashboard_fixture f CROSS JOIN session s CROSS JOIN historical_fixture h;
SET LOCAL ROLE authenticated;
INSERT INTO dashboard_result VALUES('after',get_dashboard_open_orders_v2());
RESET ROLE;
INSERT INTO historical_tap(result) SELECT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(r.result->'orders') o WHERE o->>'id'=f.id::text),
 'real open order included: '||f.label) FROM dashboard_result r,dashboard_fixture f WHERE r.phase='after' AND f.label IN ('old-real','draft','pending');
INSERT INTO historical_tap(result) SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.result->'orders') o WHERE o->>'id'=f.id::text),
 'closed or historical order excluded: '||f.label) FROM dashboard_result r,dashboard_fixture f WHERE r.phase='after' AND f.label NOT IN ('old-real','draft','pending');
INSERT INTO historical_tap(result) SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.result->'orders') o
 JOIN historical_import_documents d ON d.entity_id=(o->>'id')::uuid WHERE d.run_id=(f.result->>'run_id')::uuid),'financial history excluded') FROM dashboard_result r,historical_fixture f WHERE r.phase='after';
INSERT INTO historical_tap(result) SELECT is((a.result->>'open_count')::int-(b.result->>'open_count')::int,3,'count contains exactly real open fixtures') FROM dashboard_result a,dashboard_result b WHERE a.phase='after' AND b.phase='before';
INSERT INTO historical_tap(result) SELECT is((a.result->>'open_total')::numeric-(b.result->>'open_total')::numeric,666::numeric,'amount contains exactly real open fixtures') FROM dashboard_result a,dashboard_result b WHERE a.phase='after' AND b.phase='before';
INSERT INTO historical_tap(result) SELECT is((a.result->>'over_45_count')::int-(b.result->>'over_45_count')::int,1,'old real order remains overdue') FROM dashboard_result a,dashboard_result b WHERE a.phase='after' AND b.phase='before';
INSERT INTO historical_tap(result) SELECT is(jsonb_array_length(result->'orders'),(result->>'open_count')::int,'rows and count agree') FROM dashboard_result WHERE phase='after';
INSERT INTO historical_tap(result) SELECT is((SELECT sum((o->>'total')::numeric) FROM jsonb_array_elements(result->'orders') o),(result->>'open_total')::numeric,'rows and amount agree') FROM dashboard_result WHERE phase='after';
INSERT INTO historical_tap(result) SELECT is((SELECT status::text FROM orders WHERE financial_import_document_id=(SELECT id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),'pending_payment','financial receivable remains open') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT total FROM orders WHERE financial_import_document_id=(SELECT id FROM historical_import_documents WHERE run_id=(f.result->>'run_id')::uuid)),100000::numeric,'financial receivable amount unchanged') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT ok(NOT has_function_privilege('anon','get_dashboard_open_orders_v2()','EXECUTE'),'anon has no execute grant');
INSERT INTO historical_tap(result) SELECT ok(has_function_privilege('authenticated','get_dashboard_open_orders_v2()','EXECUTE') AND has_function_privilege('service_role','get_dashboard_open_orders_v2()','EXECUTE'),'existing caller grants retained');
GRANT INSERT,SELECT ON historical_tap TO anon;
GRANT USAGE ON SEQUENCE historical_tap_id_seq TO anon;
SET LOCAL ROLE anon;
INSERT INTO historical_tap(result) SELECT throws_ok('SELECT get_dashboard_open_orders_v2()','42501',NULL,'anon call refused');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
INSERT INTO historical_tap(result) SELECT throws_ok('SELECT get_dashboard_open_orders_v2()','42501','permission denied: orders.read required','missing identity refused');
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is(to_regprocedure('get_dashboard_open_orders_v1()'),NULL::regprocedure,'old version removed');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT result FROM historical_tap ORDER BY id;
SELECT * FROM finish();
ROLLBACK;
