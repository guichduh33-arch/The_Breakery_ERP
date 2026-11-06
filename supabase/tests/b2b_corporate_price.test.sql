-- Prix Corporate : persistance RPC et facturation serveur, sans données conservées.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE corporate_price_tap(seq serial, tap text);
CREATE TEMP TABLE corporate_price_fixture AS
 SELECT gen_random_uuid() auth_id, gen_random_uuid() profile_id,
        gen_random_uuid() customer_id, gen_random_uuid() category_id;
INSERT INTO auth.users(id) SELECT auth_id FROM corporate_price_fixture;
INSERT INTO public.user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash)
 SELECT profile_id,auth_id,'SUPER_ADMIN','Corporate price fixture','CP-'||profile_id,true,'unused-test-hash'
 FROM corporate_price_fixture;
SELECT pg_temp.authenticate_pin((SELECT auth_id FROM corporate_price_fixture));
INSERT INTO public.customer_categories(id,name,slug,price_modifier_type)
 SELECT category_id,'Corporate fixture','cp-'||category_id,'wholesale' FROM corporate_price_fixture;
INSERT INTO public.customers(id,name,customer_type,b2b_company_name,b2b_credit_limit,b2b_current_balance,category_id)
 SELECT customer_id,'Corporate fixture','b2b','Test company',NULL,0,category_id FROM corporate_price_fixture;
CREATE TEMP TABLE corporate_price_product AS
 SELECT (public.create_product_v5(jsonb_build_object(
 'name','Corporate product','sku','CP-'||gen_random_uuid(),
 'category_id',(SELECT id FROM public.categories WHERE deleted_at IS NULL LIMIT 1),
 'retail_price',40000,'track_inventory',false,'deduct_stock',false)))->'product'->>'id' AS id;

INSERT INTO corporate_price_tap(tap) SELECT lives_ok(format(
 'SELECT public.update_product_v6(%L,''{"wholesale_price":30000}'')',
 (SELECT id FROM corporate_price_product)),'Corporate price saves through the current product RPC');
INSERT INTO corporate_price_tap(tap) SELECT is((SELECT wholesale_price FROM public.products
 WHERE id=(SELECT id::uuid FROM corporate_price_product)),30000::numeric,'Corporate price is persisted');
INSERT INTO corporate_price_tap(tap) SELECT is(public._resolve_b2b_line_price_v1(
 (SELECT customer_id FROM corporate_price_fixture),(SELECT id::uuid FROM corporate_price_product)),
 30000::numeric,'wholesale customers receive the saved Corporate price');

CREATE TEMP TABLE corporate_price_order AS SELECT public.create_b2b_order_v10(
 p_customer_id => (SELECT customer_id FROM corporate_price_fixture),
 p_items => jsonb_build_array(jsonb_build_object('product_id',(SELECT id FROM corporate_price_product),
 'quantity',2,'unit_price',1))) AS result;
INSERT INTO corporate_price_tap(tap) SELECT is((SELECT unit_price FROM public.order_items
 WHERE order_id=(SELECT (result->>'order_id')::uuid FROM corporate_price_order) LIMIT 1),
 30000::numeric,'B2B creation ignores the client price and bills Corporate');
INSERT INTO corporate_price_tap(tap) SELECT is((SELECT total FROM public.orders
 WHERE id=(SELECT (result->>'order_id')::uuid FROM corporate_price_order)),60000::numeric,'B2B total uses Corporate price times quantity');

SELECT public.upsert_customer_product_price_v1((SELECT customer_id FROM corporate_price_fixture),
 (SELECT id::uuid FROM corporate_price_product),27000);
INSERT INTO corporate_price_tap(tap) SELECT is(public._resolve_b2b_line_price_v1(
 (SELECT customer_id FROM corporate_price_fixture),(SELECT id::uuid FROM corporate_price_product)),
 27000::numeric,'customer negotiated price takes priority over Corporate');
SELECT public.delete_customer_product_price_v1((SELECT customer_id FROM corporate_price_fixture),
 (SELECT id::uuid FROM corporate_price_product));
SELECT public.update_product_v6((SELECT id::uuid FROM corporate_price_product),'{"wholesale_price":0}');
INSERT INTO corporate_price_tap(tap) SELECT is(public._resolve_b2b_line_price_v1(
 (SELECT customer_id FROM corporate_price_fixture),(SELECT id::uuid FROM corporate_price_product)),
 0::numeric,'zero is a valid Corporate price');
SELECT public.update_product_v6((SELECT id::uuid FROM corporate_price_product),'{"wholesale_price":null}');
INSERT INTO corporate_price_tap(tap) SELECT ok((SELECT wholesale_price IS NULL FROM public.products
 WHERE id=(SELECT id::uuid FROM corporate_price_product)),'clearing Corporate persists NULL');
INSERT INTO corporate_price_tap(tap) SELECT is(public._resolve_b2b_line_price_v1(
 (SELECT customer_id FROM corporate_price_fixture),(SELECT id::uuid FROM corporate_price_product)),
 40000::numeric,'cleared Corporate falls back to retail');
INSERT INTO corporate_price_tap(tap) SELECT is((SELECT retail_price FROM public.products
 WHERE id=(SELECT id::uuid FROM corporate_price_product)),40000::numeric,'Corporate editing preserves the retail price');
INSERT INTO corporate_price_tap(tap) SELECT ok(EXISTS(SELECT 1 FROM public.audit_logs
 WHERE entity_id=(SELECT id::uuid FROM corporate_price_product) AND action='product.update'
 AND actor_id=(SELECT profile_id FROM corporate_price_fixture)),'Corporate edits keep the profile audit actor');
INSERT INTO corporate_price_tap(tap) SELECT * FROM finish();
SELECT tap FROM corporate_price_tap ORDER BY seq;
ROLLBACK;
