-- ADR-013 : SQL sous ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE rrc_tap (n bigserial,line text);
INSERT INTO rrc_tap(line) SELECT plan(32);
CREATE TEMP TABLE rr_ctx (
auth_id uuid,profile uuid,shift_id uuid,product_id uuid,order_id uuid,
item_id uuid,refund_id uuid,key uuid,new_key uuid,amount numeric,
sale_total numeric,cash numeric,first jsonb,
closed jsonb,replay jsonb,mismatched jsonb,reject_code text,reject_message text
);
CREATE TEMP TABLE rr_snap (stage text PRIMARY KEY,state jsonb);
CREATE FUNCTION pg_temp.rrc_state(p_order uuid,p_product uuid,p_shift uuid,p_actor uuid)
RETURNS jsonb LANGUAGE sql AS $state$
WITH je AS (SELECT j.* FROM journal_entries j WHERE j.created_by=p_actor
OR j.reference_id IN(SELECT p_order UNION SELECT p_shift
UNION SELECT id FROM refunds WHERE order_id=p_order
UNION SELECT id FROM stock_movements WHERE product_id=p_product))
SELECT jsonb_build_object(
'refunds',(SELECT coalesce(jsonb_agg(r ORDER BY r.id),'[]'::jsonb)
FROM refunds r WHERE r.order_id=p_order),
'lines',(SELECT coalesce(jsonb_agg(l ORDER BY l.id),'[]'::jsonb)
FROM refund_lines l JOIN refunds r ON r.id=l.refund_id WHERE r.order_id=p_order),
'tenders',(SELECT coalesce(jsonb_agg(t ORDER BY t.id),'[]'::jsonb)
FROM refund_payments t JOIN refunds r ON r.id=t.refund_id WHERE r.order_id=p_order),
'stock',jsonb_build_object(
'product',(SELECT to_jsonb(p) FROM products p WHERE p.id=p_product),
'movements',(SELECT coalesce(jsonb_agg(m ORDER BY m.id),'[]'::jsonb)
FROM stock_movements m WHERE m.product_id=p_product)),
'journals',(SELECT coalesce(jsonb_agg(j ORDER BY j.id),'[]'::jsonb)
FROM je j),
'journal_lines',(SELECT coalesce(jsonb_agg(l ORDER BY l.id),'[]'::jsonb)
FROM journal_entry_lines l JOIN je j ON j.id=l.journal_entry_id),
'shift',(SELECT to_jsonb(s) FROM pos_sessions s WHERE s.id=p_shift),
'zreports',(SELECT coalesce(jsonb_agg(z ORDER BY z.id),'[]'::jsonb)
FROM z_reports z WHERE z.shift_id=p_shift),
'order',(SELECT to_jsonb(o) FROM orders o WHERE o.id=p_order),
'items',(SELECT coalesce(jsonb_agg(i ORDER BY i.id),'[]'::jsonb)
FROM order_items i WHERE i.order_id=p_order),
'payments',(SELECT coalesce(jsonb_agg(p ORDER BY p.id),'[]'::jsonb)
FROM order_payments p WHERE p.order_id=p_order))
$state$;
DO $fixture$
DECLARE
c rr_ctx%ROWTYPE;
category uuid:=gen_random_uuid();
made jsonb;
sale_amount numeric;
tag text:=gen_random_uuid()::text;
BEGIN
IF NOT EXISTS (SELECT 1 FROM business_config WHERE id=1) THEN
RAISE EXCEPTION 'fixture: config missing';
END IF;
PERFORM check_fiscal_period_open(current_date);
c.auth_id:=gen_random_uuid(); c.profile:=gen_random_uuid();
c.key:=gen_random_uuid(); c.new_key:=gen_random_uuid();
INSERT INTO auth.users(id) VALUES(c.auth_id);
INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash)
VALUES(c.profile,c.auth_id,'MANAGER','[TEST] Replay',
'PGTAP-RRC-'||tag,true,hash_pin(gen_random_uuid()::text));
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT c.profile,p,true,'Replay test'
FROM unnest(ARRAY['pos.sale.create','payments.process','pos.sale.refund',
'orders.refund','shift.open','shift.close','products.create']) p;
PERFORM set_config('request.jwt.claim.sub',c.auth_id::text,true);
PERFORM set_config('request.jwt.claims',
jsonb_build_object('sub',c.auth_id,'role','authenticated')::text,true);
INSERT INTO categories(id,name,slug)
VALUES(category,'[TEST] Replay','pgtap-rrc-'||tag);
made:=create_product_v3(jsonb_build_object(
'sku','ZZ-TEST-RRC-'||tag,'name','[TEST] Replay product',
'category_id',category,'retail_price',22000,'cost_price',5000,'unit','pcs',
'track_inventory',true,'deduct_stock',false,'is_display_item',false,
'is_active',true,'available_for_sale',true,'visible_on_pos',true));
c.product_id:=(made#>>'{product,id}')::uuid;
PERFORM record_stock_movement_v1(c.product_id,'adjustment_in',10,
'Replay stock',p_unit_cost:=5000,
p_idempotency_key:=gen_random_uuid(),p_unit:='pcs',
p_metadata:=jsonb_build_object('reference_type','test_fixture','reference_id',c.product_id));
INSERT INTO pos_sessions(opened_by,opening_cash,status)
VALUES(c.profile,100000,'open') RETURNING id INTO c.shift_id;
SELECT total INTO sale_amount FROM _pb1_split_v1(44000);
made:=complete_order_with_payment_v30(
p_session_id:=c.shift_id,p_order_type:='take_out',
p_items:=jsonb_build_array(jsonb_build_object(
'product_id',c.product_id,'quantity',2,'unit_price',22000,'modifiers','[]'::jsonb)),
p_payment:=jsonb_build_object('method','cash','amount',sale_amount,
'cash_received',sale_amount,'change_given',0),
p_idempotency_key:=gen_random_uuid());
c.order_id:=(made->>'order_id')::uuid;
SELECT id INTO STRICT c.item_id FROM order_items WHERE order_id=c.order_id;
SELECT total INTO c.sale_total FROM orders WHERE id=c.order_id;
SELECT s.total INTO c.amount FROM order_items i
CROSS JOIN LATERAL _pb1_split_v1(round_idr(i.line_total/i.quantity)) s
WHERE i.id=c.item_id;
c.first:=refund_order_rpc_v13(c.order_id,
jsonb_build_array(jsonb_build_object('order_item_id',c.item_id,'qty',1)),
jsonb_build_array(jsonb_build_object('method','cash','amount',c.amount)),
'Replay test',c.profile,c.key,c.auth_id);
c.refund_id:=(c.first->>'refund_id')::uuid;
c.cash:=100000+c.sale_total-c.amount;
INSERT INTO rr_ctx SELECT c.*;
END $fixture$;
SET CONSTRAINTS ALL IMMEDIATE;
DO $close$
DECLARE c rr_ctx%ROWTYPE; grid jsonb:='{}'::jsonb;
remaining numeric; denomination integer; pieces numeric;
BEGIN
SELECT * INTO STRICT c FROM rr_ctx;
remaining:=c.cash;
FOREACH denomination IN ARRAY ARRAY[100000,50000,20000,10000,5000,2000,1000,500,200,100] LOOP
pieces:=floor(remaining/denomination);
grid:=grid || jsonb_build_object(denomination::text,pieces);
remaining:=remaining-pieces*denomination;
END LOOP;
IF remaining<>0 THEN RAISE EXCEPTION 'fixture: cash grid'; END IF;
UPDATE rr_ctx SET closed=close_shift_v10(c.shift_id,c.cash,
p_notes:='Replay close',p_idempotency_key:=gen_random_uuid(),
p_counted_qris:=0,p_counted_card:=0,p_denominations:=grid);
END $close$;
INSERT INTO rr_snap
SELECT 'closed',pg_temp.rrc_state(order_id,product_id,shift_id,profile) FROM rr_ctx;
DO $replay$
DECLARE c rr_ctx%ROWTYPE; result jsonb; code text; message text;
BEGIN
SELECT * INTO STRICT c FROM rr_ctx;
result:=refund_order_rpc_v13(c.order_id,
jsonb_build_array(jsonb_build_object('order_item_id',c.item_id,'qty',1)),
jsonb_build_array(jsonb_build_object('method','cash','amount',c.amount)),
'Replay test',c.profile,c.key,c.auth_id);
UPDATE rr_ctx SET replay=result;
-- La clé persistée fait foi même si la requête présente une autre commande.
result:=refund_order_rpc_v13(gen_random_uuid(),
jsonb_build_array(jsonb_build_object('order_item_id',c.item_id,'qty',1)),
jsonb_build_array(jsonb_build_object('method','cash','amount',c.amount)),
'Replay different order',c.profile,c.key,c.auth_id);
UPDATE rr_ctx SET mismatched=result;
INSERT INTO rr_snap VALUES('replay',
pg_temp.rrc_state(c.order_id,c.product_id,c.shift_id,c.profile));
BEGIN
PERFORM refund_order_rpc_v13(c.order_id,
jsonb_build_array(jsonb_build_object('order_item_id',c.item_id,'qty',1)),
jsonb_build_array(jsonb_build_object('method','cash','amount',c.amount)),
'Replay test',c.profile,c.new_key,c.auth_id);
code:='NO_ERROR'; message:='NO_ERROR';
EXCEPTION WHEN OTHERS THEN
GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
END;
UPDATE rr_ctx SET reject_code=code,reject_message=message;
INSERT INTO rr_snap VALUES('rejected',
pg_temp.rrc_state(c.order_id,c.product_id,c.shift_id,c.profile));
END $replay$;
DO $checks$
DECLARE c rr_ctx%ROWTYPE; b jsonb; a jsonb; rejected jsonb; expected jsonb;
signature text:='public.refund_order_rpc_v13(uuid,jsonb,jsonb,text,uuid,uuid,uuid)';
BEGIN
SELECT * INTO STRICT c FROM rr_ctx;
SELECT state INTO STRICT b FROM rr_snap WHERE stage='closed';
SELECT state INTO STRICT a FROM rr_snap WHERE stage='replay';
SELECT state INTO STRICT rejected FROM rr_snap WHERE stage='rejected';
SELECT jsonb_build_object('refund_id',r->'id','refund_number',r->'refund_number',
'order_id',r->'order_id','order_number',b#>'{order,order_number}',
 'total_refunded',r->'total','tax_refunded',r->'tax_refunded')
INTO expected FROM (SELECT b->'refunds'->0 AS r) persisted;
INSERT INTO rrc_tap(line) VALUES
(ok(to_regprocedure('public.refund_order_rpc_v11(uuid,jsonb,jsonb,text,uuid,uuid,uuid)') IS NULL,
'Previous refund signature dropped')),
(ok(has_function_privilege('service_role',signature,'EXECUTE'),'Service EXECUTE')),
(ok(NOT has_function_privilege('authenticated',signature,'EXECUTE'),'User denied')),
(ok(NOT has_function_privilege('anon',signature,'EXECUTE'),'Anon denied')),
(ok(NOT EXISTS(SELECT 1 FROM pg_proc p
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
WHERE p.oid=signature::regprocedure AND x.grantee=0 AND x.privilege_type='EXECUTE'),
'PUBLIC denied')),
(ok(c.refund_id IS NOT NULL AND NOT coalesce((c.first->>'idempotent_replay')::boolean,false),
'First refund')),
(ok((SELECT o.status IN ('paid','completed') AND i.quantity=2 AND NOT o.is_historical_import
FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.id=c.item_id),
'Paid qty=2')),
(ok((SELECT count(*) FROM refunds WHERE order_id=c.order_id)=1
AND (SELECT session_id FROM refunds WHERE id=c.refund_id)=c.shift_id,
'Origin shift')),
(is((SELECT sum(qty) FROM refund_lines WHERE refund_id=c.refund_id),1::numeric,'Refund qty=1')),
(ok((SELECT count(*) FROM refund_payments WHERE refund_id=c.refund_id)=1
AND (SELECT sum(amount) FROM refund_payments WHERE refund_id=c.refund_id AND method='cash')=c.amount,
'Cash tender')),
(is((SELECT current_stock FROM products WHERE id=c.product_id),9::numeric,'Stock=9')),
(ok((SELECT count(*) FROM stock_movements WHERE product_id=c.product_id AND reference_type='refunds'
AND reference_id=c.refund_id AND movement_type='sale_void' AND quantity=1)=1,'Stock restore')),
(ok((SELECT count(*) FROM journal_entries WHERE reference_type='sale' AND reference_id=c.order_id)=1
AND (SELECT sum(l.debit)=c.sale_total AND sum(l.credit)=c.sale_total
FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
WHERE j.reference_type='sale' AND j.reference_id=c.order_id),'Sale JE balanced')),
(ok((SELECT count(*) FROM journal_entries WHERE reference_type='sale_refund' AND reference_id=c.refund_id)=1
AND (SELECT sum(l.debit)=c.amount AND sum(l.credit)=c.amount
FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
WHERE j.reference_type='sale_refund' AND j.reference_id=c.refund_id),'Refund JE balanced')),
(ok((SELECT status='closed' AND closed_by=c.profile FROM pos_sessions WHERE id=c.shift_id),
'Closed by profile')),
(is((c.closed->>'expected_cash')::numeric,c.cash,'Net cash')),
(ok((c.closed->>'variance')::numeric=0 AND NOT EXISTS(
SELECT 1 FROM journal_entries WHERE reference_type='shift_close' AND reference_id=c.shift_id),
'No variance JE')),
(ok((SELECT count(*) FROM z_reports WHERE shift_id=c.shift_id)=1
AND (SELECT (snapshot#>>'{totals_by_payment_method,cash}')::numeric
FROM z_reports WHERE shift_id=c.shift_id)=c.sale_total-c.amount,'Z-report cash')),
(ok((c.replay->>'idempotent_replay')::boolean,'Replay after close')),
(ok(jsonb_typeof(c.first)='object' AND jsonb_typeof(c.replay)='object'
AND NOT EXISTS(SELECT 1 FROM jsonb_each(expected) e WHERE e.value='null'::jsonb)
AND jsonb_typeof(expected->'order_number')='string'
AND length(expected->>'order_number')>0
AND c.first@>expected AND c.replay@>expected,'Stored identity/order number/amounts')),
(ok(c.mismatched@>expected AND (c.mismatched->>'idempotent_replay')::boolean,
'Replay uses persisted order identity and number')),
(is(a->'refunds',b->'refunds','Replay refunds')),
(is(a->'lines',b->'lines','Replay lines')),
(is(a->'tenders',b->'tenders','Replay: tenders')),
(is(a->'stock',b->'stock','Replay stock/ledger')),
(ok(a->'journals'=b->'journals' AND a->'journal_lines'=b->'journal_lines','Replay: JE/lines')),
(ok(a->'shift'=b->'shift' AND a->'zreports'=b->'zreports','Replay: shift/Z-report')),
(ok(c.reject_code='P0016' AND c.reject_message='cash_refund_requires_open_session',
'New cash key: P0016')),
(ok(NOT EXISTS(SELECT 1 FROM refunds WHERE idempotency_key=c.new_key),'No new-key refund')),
(is(rejected,b,'Rejected state unchanged')),
(is((SELECT i.quantity-coalesce(sum(l.qty),0) FROM order_items i
LEFT JOIN refund_lines l ON l.order_item_id=i.id WHERE i.id=c.item_id GROUP BY i.quantity),
1::numeric,'One unit remains')),
(is((SELECT count(*)::int FROM audit_logs WHERE action='order.refund' AND entity_id=c.order_id),
1,'One refund audit'));
END $checks$;
SELECT line FROM (
SELECT n,line FROM rrc_tap
UNION ALL SELECT 1000000+row_number() OVER (),f FROM finish() f
) evidence ORDER BY n;
ROLLBACK;
