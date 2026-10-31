BEGIN;
\ir helpers/pin_session.sql
SELECT plan(7);
\ir helpers/historical_import.sql
-- Le mode financier ne modifie pas le checkout normal ni ses gardes de stock.
CREATE TEMP TABLE normal_money(session_id uuid,result jsonb,replay jsonb);
WITH session AS (INSERT INTO pos_sessions(opened_by,opening_cash,status)
 SELECT actor,0,'open' FROM historical_fixture RETURNING id)
INSERT INTO normal_money(session_id) SELECT id FROM session;
UPDATE promotions SET is_active=false WHERE is_active;
UPDATE normal_money SET result=complete_order_with_payment_v31(
 p_session_id:=session_id,p_order_type:='take_out',
 p_items:=(SELECT jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_price',100,'modifiers','[]'::jsonb)) FROM historical_fixture),
 p_payment:=jsonb_build_object('method','cash','amount',100,'cash_received',100,'change_given',0),
 p_idempotency_key:=(SELECT client_key FROM historical_fixture));
INSERT INTO historical_tap(result) SELECT is((SELECT status::text FROM orders WHERE id=(n.result->>'order_id')::uuid),'paid','normal checkout still settles a real sale') FROM normal_money n;
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.product),9::numeric,'normal checkout still consumes global stock') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT sum(amount) FROM order_payments WHERE order_id=(n.result->>'order_id')::uuid),100::numeric,'normal checkout keeps exact real cash receipt') FROM normal_money n;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM journal_entries WHERE reference_type='sale' AND reference_id=(n.result->>'order_id')::uuid),1::bigint,'normal checkout still emits its sale JE exactly once') FROM normal_money n;
UPDATE normal_money SET replay=complete_order_with_payment_v31(
 p_session_id:=session_id,p_order_type:='take_out',
 p_items:=(SELECT jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_price',100,'modifiers','[]'::jsonb)) FROM historical_fixture),
 p_payment:=jsonb_build_object('method','cash','amount',100,'cash_received',100,'change_given',0),
 p_idempotency_key:=(SELECT client_key FROM historical_fixture));
INSERT INTO historical_tap(result) SELECT is(replay->>'order_id',result->>'order_id','normal checkout replay returns existing order') FROM normal_money;
INSERT INTO historical_tap(result) SELECT is((SELECT current_stock FROM products WHERE id=f.product),9::numeric,'normal replay never consumes stock twice') FROM historical_fixture f;
UPDATE products SET is_display_item=true WHERE id=(SELECT product FROM historical_fixture);
INSERT INTO display_stock(product_id,quantity) SELECT product,0 FROM historical_fixture
 ON CONFLICT(product_id) DO UPDATE SET quantity=0;
INSERT INTO historical_tap(result) SELECT throws_ok($q$SELECT _record_sale_stock_v1(product,1,gen_random_uuid(),actor,'Normal empty display guard','sale','orders','pcs',true)
 FROM historical_fixture$q$,'P0002',NULL,'normal sale helper still refuses empty display stock');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT jsonb_build_object('executed',(SELECT count(*) FROM historical_tap),
 'failures',(SELECT coalesce(jsonb_agg(result),'[]') FROM historical_tap WHERE result LIKE 'not ok%'),
 'tap_finish',(SELECT coalesce(jsonb_agg(result),'[]') FROM finish() result)) AS test_result;
ROLLBACK;
