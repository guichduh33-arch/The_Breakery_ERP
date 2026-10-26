-- Prix canoniques et vraies sessions PIN ; fixtures indépendantes sous rollback.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE pq_actor(kind text PRIMARY KEY,auth_id uuid,profile_id uuid);
INSERT INTO pq_actor SELECT k,gen_random_uuid(),gen_random_uuid() FROM unnest(ARRAY['reader','cashier','denied']) k;
INSERT INTO auth.users(id) SELECT auth_id FROM pq_actor;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 SELECT profile_id,auth_id,'PQ-'||profile_id,'Quote fixture','CASHIER','fixture-not-a-pin-hash',true FROM pq_actor;
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.profile_id,p.code,(a.kind='reader' AND p.code='customers.read') OR (a.kind='cashier' AND p.code='pos.sale.create'),
 'Transactional pricing fixture' FROM pq_actor a CROSS JOIN public.permissions p WHERE p.code IN ('customers.read','pos.sale.create');
CREATE TEMP TABLE pq_var(name text PRIMARY KEY,id uuid);
WITH c AS (INSERT INTO public.categories(name,slug) VALUES('Quote fixture','pq-'||gen_random_uuid()) RETURNING id)
 INSERT INTO pq_var SELECT 'product-category',id FROM c;
WITH c AS (INSERT INTO public.customer_categories(name,slug,price_modifier_type)
 VALUES('Quote fixture','pq-'||gen_random_uuid(),'custom') RETURNING id)
 INSERT INTO pq_var SELECT 'customer-category',id FROM c;
INSERT INTO pq_var SELECT k,gen_random_uuid() FROM unnest(ARRAY['negotiated','category','retail','deleted','nan','customer','deleted-customer']) k;
INSERT INTO public.products(id,sku,name,category_id,retail_price,deleted_at)
 SELECT p.id,'PQ-'||p.id,'Quote fixture',c.id,5000,CASE WHEN p.name='deleted' THEN now() END
 FROM pq_var p CROSS JOIN pq_var c WHERE p.name IN ('negotiated','category','retail','deleted','nan') AND c.name='product-category';
INSERT INTO public.customers(id,name,category_id,deleted_at)
 SELECT p.id,'Quote fixture',c.id,CASE WHEN p.name='deleted-customer' THEN now() END
 FROM pq_var p CROSS JOIN pq_var c WHERE p.name IN ('customer','deleted-customer') AND c.name='customer-category';
INSERT INTO public.product_category_prices(product_id,customer_category_id,price)
 SELECT p.id,c.id,4000 FROM pq_var p CROSS JOIN pq_var c WHERE p.name IN ('negotiated','category') AND c.name='customer-category';
INSERT INTO public.customer_product_prices(customer_id,product_id,price)
 SELECT c.id,p.id,CASE WHEN p.name='nan' THEN 'NaN'::numeric ELSE 3000 END FROM pq_var c CROSS JOIN pq_var p
 WHERE c.name='customer' AND p.name IN ('negotiated','nan');
GRANT SELECT ON pq_actor,pq_var TO authenticated;
SELECT ok(NOT has_function_privilege('anon','public.get_pos_product_price_v1(uuid,uuid)','EXECUTE'),'anon cannot quote prices');
SELECT ok(has_function_privilege('authenticated','public.get_pos_product_price_v1(uuid,uuid)','EXECUTE'),'authenticated can reach the guarded quote');
SELECT ok(NOT has_function_privilege('authenticated','public._resolve_b2b_line_price_v1(uuid,uuid)','EXECUTE'),'private canonical resolver stays private');
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM pq_actor WHERE kind='reader')); END $$;
SET LOCAL ROLE authenticated;
SELECT is(public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='negotiated'),(SELECT id FROM pq_var WHERE name='customer')),3000::numeric,'negotiated price has priority');
SELECT is(public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='negotiated'),NULL),5000::numeric,'anonymous cart uses retail');
SELECT is(public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='category'),(SELECT id FROM pq_var WHERE name='customer')),4000::numeric,'category custom price follows negotiated price');
SELECT is(public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='retail'),(SELECT id FROM pq_var WHERE name='customer')),5000::numeric,'missing category price falls back to retail');
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1(gen_random_uuid(),NULL)$q$,'P0002','product_not_found','unknown product is refused');
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='retail'),gen_random_uuid())$q$,'P0002','customer_not_found','unknown customer is refused');
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='retail'),(SELECT id FROM pq_var WHERE name='deleted-customer'))$q$,'P0002','customer_not_found','deleted customer is refused');
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='deleted'),NULL)$q$,'P0002','product_not_found','deleted product is refused');
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='nan'),(SELECT id FROM pq_var WHERE name='customer'))$q$,'22023','invalid_product_price','NaN price is refused');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM pq_actor WHERE kind='cashier')); END $$;
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.has_permission(auth.uid(),'customers.read') AND public.has_permission(auth.uid(),'pos.sale.create'),'cashier fixture has sale access without general customer read');
SELECT is(public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='negotiated'),(SELECT id FROM pq_var WHERE name='customer')),3000::numeric,'cashier can quote the negotiated sale price');
SELECT is((SELECT count(*) FROM public.customer_product_prices WHERE customer_id=(SELECT id FROM pq_var WHERE name='customer')),0::bigint,'cashier does not gain raw negotiated price access');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM pq_actor WHERE kind='denied')); END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='retail'),(SELECT id FROM pq_var WHERE name='customer'))$q$,'42501','permission_denied','customer price requires customer read or sale access');
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='retail'),NULL)$q$,'42501','permission_denied','no sale or customer access cannot quote');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='retail'),NULL)$q$,'42501','active_pin_session_required','missing session cannot quote');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM pq_actor WHERE kind='reader')); END $$;
UPDATE public.user_sessions SET ended_at=now() WHERE id=(current_setting('request.jwt.claims')::jsonb->>'session_id')::uuid;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_pos_product_price_v1((SELECT id FROM pq_var WHERE name='retail'),NULL)$q$,'42501','active_pin_session_required','revoked session cannot quote');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
