-- Contrôle antifraude : assertions exécutées sous rôle réel, transaction annulée.
BEGIN;
\ir helpers/pin_session.sql
\ir helpers/antifraud_actors.sql
SELECT no_plan();
CREATE TEMP TABLE guard_results(seq serial, tap text);
CREATE TEMP TABLE guard_ids AS SELECT gen_random_uuid() product_id, gen_random_uuid() variant_id, gen_random_uuid() count_product_id,gen_random_uuid() display_product_id,gen_random_uuid() display_key,
 gen_random_uuid() declaration_key, gen_random_uuid() own_key, gen_random_uuid() count_key,
 gen_random_uuid() pending_order, gen_random_uuid() paid_order, gen_random_uuid() old_order,
 gen_random_uuid() register_id, gen_random_uuid() register_profile_id;
CREATE TEMP TABLE guard_actors AS
 SELECT DISTINCT ON(role_code) id,auth_user_id,role_code FROM user_profiles
 WHERE id IN(SELECT id FROM antifraud_test_actors)
 AND role_code IN ('SUPER_ADMIN','ADMIN','CASHIER') AND is_active AND deleted_at IS NULL
 AND auth_user_id IS NOT NULL ORDER BY role_code,id;
CREATE TEMP TABLE guard_existing_open_sessions AS SELECT id FROM pos_sessions WHERE status='open';
CREATE TEMP TABLE guard_payload(name text PRIMARY KEY,value jsonb);
GRANT ALL ON guard_results,guard_ids,guard_actors,guard_payload TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE guard_results_seq_seq TO authenticated;
INSERT INTO guard_results(tap) SELECT is((SELECT count(*) FROM guard_actors),3::bigint,'Three active roles exist');
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.id,p.code,true,'Transactional confidentiality test' FROM guard_actors a CROSS JOIN permissions p
 WHERE p.code IN ('inventory.read','inventory.adjust','inventory.waste','inventory.opname.create',
 'inventory.opname.finalize','display.manage','reports.product_sales.read','orders.read','pos.sale.create')
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
UPDATE business_day_visibility_config SET activated_on=current_date-1;
INSERT INTO products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit)
 SELECT product_id,'GUARD-'||product_id,'Confidential product',(SELECT id FROM categories LIMIT 1),1000,0,17,'pcs' FROM guard_ids;
INSERT INTO products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit)
 SELECT count_product_id,'GUARD-COUNT-'||count_product_id,'Independent count product',(SELECT id FROM categories LIMIT 1),1000,0,17,'pcs' FROM guard_ids;
INSERT INTO products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit,is_display_item)
 SELECT display_product_id,'GUARD-DISPLAY-'||display_product_id,'Display loss regression',(SELECT id FROM categories LIMIT 1),1000,0,1,'pcs',true FROM guard_ids;
UPDATE display_stock SET quantity=5 WHERE product_id=(SELECT display_product_id FROM guard_ids);
INSERT INTO products(id,sku,name,category_id,retail_price,parent_product_id,visible_on_pos,is_active,variant_label,variant_axis)
 SELECT variant_id,'GUARD-'||variant_id,'Hidden active variant',(SELECT id FROM categories LIMIT 1),1000,product_id,false,true,'Regular','size' FROM guard_ids;
INSERT INTO user_profiles(id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT register_profile_id,'GUARD-'||register_profile_id,'Day guard register fixture','invalid-fixture-hash','CASHIER',false FROM guard_ids;
INSERT INTO pos_sessions(id,opened_by,opening_cash,status) SELECT register_id,register_profile_id,0,'open' FROM guard_ids;
INSERT INTO orders(id,order_number,status,subtotal,tax_amount,total,paid_at,created_at,session_id)
 SELECT pending_order,'GUARD-P-'||pending_order,'pending_payment'::order_status,1000,0,1000,NULL,now(),register_id FROM guard_ids UNION ALL
 SELECT paid_order,'GUARD-D-'||paid_order,'completed'::order_status,1000,0,1000,now(),now(),register_id FROM guard_ids UNION ALL
 SELECT old_order,'GUARD-H-'||old_order,'completed'::order_status,1000,0,1000,now()-interval '2 days',now()-interval '2 days',register_id FROM guard_ids;
INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status,dispatch_station,served_at)
 SELECT paid_order,product_id,'Confidential product',1000,1,1000,'ready','kitchen',now() FROM guard_ids;

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM guard_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO guard_results(tap) SELECT ok(NOT can_view_business_day_v1(current_date),'Cashier cannot view activation day');
INSERT INTO guard_results(tap) SELECT ok(can_view_business_day_v1(current_date-2),'Preactivation history remains readable');
INSERT INTO guard_results(tap) SELECT is((SELECT count(*) FROM orders WHERE id=(SELECT paid_order FROM guard_ids)),0::bigint,'Finished order blocked by RLS');
INSERT INTO guard_results(tap) SELECT is((SELECT count(*) FROM order_items WHERE order_id=(SELECT paid_order FROM guard_ids)),0::bigint,'Finished order lines blocked by RLS');
INSERT INTO guard_results(tap) SELECT ok(can_view_order_v1(pending_order),'Unpaid operational order remains usable') FROM guard_ids;
INSERT INTO guard_results(tap) SELECT ok(can_view_order_v1(old_order),'Historical order remains visible') FROM guard_ids;
INSERT INTO guard_results(tap) SELECT throws_ok('SELECT current_stock FROM products LIMIT 1','42501',NULL,'Raw stock column denied');
INSERT INTO guard_payload SELECT 'catalogue',get_operational_products_v1();
INSERT INTO guard_results(tap) SELECT is((SELECT value->>'current_stock' FROM jsonb_array_elements((SELECT value FROM guard_payload WHERE name='catalogue')) WHERE value->>'id'=(SELECT product_id::text FROM guard_ids)),NULL::text,'RPC masks exact stock');
INSERT INTO guard_results(tap) SELECT is((SELECT value->>'has_variants' FROM jsonb_array_elements((SELECT value FROM guard_payload WHERE name='catalogue')) WHERE value->>'id'=(SELECT product_id::text FROM guard_ids)),'true','Hidden active variant still marks parent');
INSERT INTO guard_results(tap) SELECT throws_ok('SELECT get_sales_by_product_v2(current_date,current_date)','P0003','business_day_not_released','Product report fails closed');
INSERT INTO guard_payload SELECT 'declaration',adjust_stock_v4(product_id,20,'Blind count declaration',declaration_key) FROM guard_ids;
INSERT INTO guard_results(tap) SELECT is((SELECT value->>'status' FROM guard_payload WHERE name='declaration'),'pending','Adjustment becomes declaration');
INSERT INTO guard_results(tap) SELECT ok((adjust_stock_v4(product_id,20,'Blind count declaration',declaration_key)->>'idempotent_replay')::boolean,'Declaration retry is idempotent') FROM guard_ids;
INSERT INTO guard_results(tap) SELECT throws_ok(format('SELECT adjust_stock_v4(%L,21,%L,%L)',product_id,'Blind count declaration',declaration_key),'22023','idempotency_conflict','Changed retry rejected') FROM guard_ids;
INSERT INTO guard_results(tap) SELECT throws_ok(format('SELECT approve_stock_declaration_v3(%L)',(SELECT value->>'declaration_id' FROM guard_payload WHERE name='declaration')),'P0003','owner_required','Cashier cannot approve');
INSERT INTO guard_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(get_stock_declarations_v1()) e WHERE e ? 'baseline_quantity' OR e ? 'result'),'Declaration list omits theoretical baseline');
INSERT INTO guard_payload SELECT 'display_waste',waste_display_stock_v4(display_product_id,2,'Display loss regression',display_key) FROM guard_ids;
INSERT INTO guard_payload SELECT 'count',create_opname_v3('After midnight count',count_key,current_date-1) FROM guard_ids;
INSERT INTO guard_payload SELECT 'item',add_opname_item_v3((SELECT (value->>'count_id')::uuid FROM guard_payload WHERE name='count'),count_product_id) FROM guard_ids;
INSERT INTO guard_results(tap) SELECT is((SELECT value->>'expected_qty' FROM guard_payload WHERE name='item'),NULL::text,'Add item never reveals expected quantity');
SELECT set_opname_count_v3((SELECT (value->>'item_id')::uuid FROM guard_payload WHERE name='item'),20,'Independent physical count');
INSERT INTO guard_results(tap) SELECT is((get_opname_items_v1((SELECT (value->>'count_id')::uuid FROM guard_payload WHERE name='count'))->0->>'variance'),NULL::text,'Count variance remains masked');
SELECT validate_opname_v2((SELECT (value->>'count_id')::uuid FROM guard_payload WHERE name='count'));
INSERT INTO guard_results(tap) SELECT throws_ok(format('SELECT finalize_opname_v5(%L)',(SELECT value->>'count_id' FROM guard_payload WHERE name='count')),'P0003','forbidden','Cashier cannot finalize');
RESET ROLE;
INSERT INTO guard_results(tap) SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM guard_ids)),17::numeric,'Declaration has no stock effect before owner approval');

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM guard_actors WHERE role_code='ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO guard_results(tap) SELECT ok(NOT can_view_business_day_v1(current_date),'Admin also locked');
INSERT INTO guard_results(tap) SELECT throws_ok('SELECT get_sales_by_product_v2(current_date,current_date)','P0003','business_day_not_released','Admin cannot bypass through RPC');
RESET ROLE;

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM guard_actors WHERE role_code='SUPER_ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO guard_results(tap) SELECT ok(can_view_business_day_v1(current_date),'Owner retains visibility');
SELECT approve_stock_declaration_v3((SELECT (value->>'declaration_id')::uuid FROM guard_payload WHERE name='declaration'));
INSERT INTO guard_results(tap) SELECT ok((approve_stock_declaration_v3((SELECT (value->>'declaration_id')::uuid FROM guard_payload WHERE name='declaration'))->>'idempotent_replay')::boolean,'Approval retry is idempotent');
INSERT INTO guard_payload SELECT 'own',waste_stock_v4(product_id,1,'Owner own declaration',own_key) FROM guard_ids;
INSERT INTO guard_results(tap) SELECT throws_ok(format('SELECT approve_stock_declaration_v3(%L)',(SELECT value->>'declaration_id' FROM guard_payload WHERE name='own')),'P0003','independent_approver_required','Owner cannot approve own declaration');
INSERT INTO guard_payload SELECT 'display_approval',approve_stock_declaration_v3((SELECT (value->>'declaration_id')::uuid FROM guard_payload WHERE name='display_waste'));
INSERT INTO guard_results(tap) SELECT is((SELECT value->>'status' FROM guard_payload WHERE name='display_approval'),'approved','Display loss preserves allowed negative global stock');
SELECT finalize_opname_v5((SELECT (value->>'count_id')::uuid FROM guard_payload WHERE name='count'));
INSERT INTO guard_results(tap) SELECT ok((finalize_opname_v5((SELECT (value->>'count_id')::uuid FROM guard_payload WHERE name='count'))->>'idempotent_replay')::boolean,'Finalization replay emits no duplicate');
RESET ROLE;
INSERT INTO guard_results(tap) SELECT is((SELECT current_stock FROM products WHERE id=(SELECT count_product_id FROM guard_ids)),20::numeric,'Count finalization applies its independent variance');
INSERT INTO guard_results(tap) SELECT is((SELECT current_stock FROM products WHERE id=(SELECT display_product_id FROM guard_ids)),-1::numeric,'Display waste deducts global stock even below zero');
INSERT INTO guard_results(tap) SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT display_product_id FROM guard_ids)),3::numeric,'Display waste still respects shelf availability');
-- Déclaration propriétaire de test résolue par un acteur distinct pour isoler la libération.
UPDATE stock_declarations SET status='rejected',reviewed_by=(SELECT id FROM guard_actors WHERE role_code='ADMIN'),reviewed_at=now() WHERE id=(SELECT (value->>'declaration_id')::uuid FROM guard_payload WHERE name='own');

SET LOCAL ROLE authenticated;
INSERT INTO guard_results(tap) SELECT throws_ok(format('SELECT release_business_day_v1(current_date-1,%L)',(SELECT value->>'count_id' FROM guard_payload WHERE name='count')),'P0001','registers_still_open','Any open register prevents release');
RESET ROLE;
-- Fermeture uniquement des registres relevés au début et de la fixture ; annulée au ROLLBACK.
UPDATE pos_sessions SET status='closed' WHERE status='open' AND
 (id=(SELECT register_id FROM guard_ids) OR id IN(SELECT id FROM guard_existing_open_sessions));
SET LOCAL ROLE authenticated;
SELECT release_business_day_v1(current_date-1,(SELECT (value->>'count_id')::uuid FROM guard_payload WHERE name='count'));
INSERT INTO guard_results(tap) SELECT ok((release_business_day_v1(current_date-1,(SELECT (value->>'count_id')::uuid FROM guard_payload WHERE name='count'))->>'idempotent_replay')::boolean,'Release is idempotent');
RESET ROLE;
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM guard_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO guard_results(tap) SELECT ok(can_view_business_day_v1(current_date-1),'After midnight count releases its explicit business day');
INSERT INTO guard_results(tap) SELECT ok(NOT can_view_business_day_v1(current_date),'Release never unlocks another date');
SELECT create_opname_v3('New count invalidates yesterday',gen_random_uuid(),current_date-1);
INSERT INTO guard_results(tap) SELECT ok(NOT can_view_business_day_v1(current_date-1),'New historical-day count invalidates that same day');
RESET ROLE;
INSERT INTO guard_results(tap) SELECT ok(NOT has_function_privilege('authenticated','public.record_stock_movement_v1(uuid,movement_type,numeric,text,numeric,uuid,uuid,text,uuid,uuid,jsonb,uuid,boolean)','EXECUTE'),'Ledger primitive remains private');
INSERT INTO guard_results(tap) SELECT ok(NOT has_schema_privilege('authenticated','stock_private','USAGE'),'Copied implementations cannot be called directly');
INSERT INTO guard_results(tap) SELECT ok(NOT has_function_privilege('anon','public.get_operational_products_v1()','EXECUTE'),'Anonymous RPC denied');
INSERT INTO guard_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='products'),'Raw realtime cannot leak stock column');
INSERT INTO guard_results(tap) SELECT is((SELECT count(*) FROM stock_movements WHERE product_id=(SELECT product_id FROM guard_ids) AND reference_type='stock_declaration'),1::bigint,'Single approved declaration ledger effect');
INSERT INTO guard_results(tap) SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE action='stock.declaration_approved' AND actor_id=(SELECT id FROM guard_actors WHERE role_code='SUPER_ADMIN')),'Audit actor is owner profile');
INSERT INTO guard_results(tap) SELECT * FROM finish();
SELECT count(*) FILTER(WHERE tap LIKE 'not ok%') failures,count(*) total,jsonb_agg(tap ORDER BY seq) lines FROM guard_results;
ROLLBACK;
