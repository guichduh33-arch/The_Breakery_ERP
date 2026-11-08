BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE day_results(seq serial,tap text);
CREATE TEMP TABLE day_actors AS SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('CASHIER')) r(role_code);
INSERT INTO auth.users(id,email) SELECT auth_user_id,auth_user_id||'@display-day.invalid' FROM day_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'DAY-'||id,'Daily display fixture','invalid-test-hash',role_code,true FROM day_actors;
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.id,p.code,true,'Transactional day count' FROM day_actors a CROSS JOIN public.permissions p
 WHERE a.role_code='CASHIER' AND p.code IN('display.count','display.read')
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
CREATE TEMP TABLE day_ids AS SELECT gen_random_uuid() general_id,gen_random_uuid() fresh_id,gen_random_uuid() submit_key,
 gen_random_uuid() correction_key,gen_random_uuid() production_id;
CREATE TEMP TABLE day_payload(name text PRIMARY KEY,value jsonb);
CREATE TEMP TABLE day_display_baseline AS SELECT id,current_stock FROM public.products WHERE sku='IND-005' AND deleted_at IS NULL;
UPDATE public.products SET is_display_item=true WHERE id=(SELECT id FROM day_display_baseline);
INSERT INTO public.display_stock(product_id,quantity) SELECT id,30 FROM day_display_baseline
 ON CONFLICT(product_id) DO UPDATE SET quantity=30;
GRANT ALL ON day_results,day_payload TO authenticated;
GRANT SELECT ON day_actors,day_ids,day_display_baseline TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE day_results_seq_seq TO authenticated;
INSERT INTO public.categories(name,slug) VALUES('Sourdough fixture','sourdough-breads') ON CONFLICT(slug) DO NOTHING;
INSERT INTO public.products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit,is_display_item)
 SELECT general_id,'DAY-G-'||general_id,'General count fixture',
  (SELECT id FROM public.categories WHERE slug<>'sourdough-breads' LIMIT 1),10000,1000,20,'pcs',true FROM day_ids UNION ALL
 SELECT fresh_id,'DAY-F-'||fresh_id,'Fresh count fixture',
  (SELECT id FROM public.categories WHERE slug='sourdough-breads'),10000,1000,100,'pcs',true FROM day_ids;
UPDATE public.display_stock SET quantity=20 WHERE product_id=(SELECT general_id FROM day_ids);
UPDATE public.display_stock SET quantity=15 WHERE product_id=(SELECT fresh_id FROM day_ids);
INSERT INTO public.production_records(id,production_number,product_id,quantity_produced,quantity_waste,
 production_date,section_id,staff_id,actual_yield_qty,waste_reason)
 SELECT production_id,'PROD-'||to_char(current_date,'YYYYMMDD')||'-'||(1000000000+abs(hashtext(production_id::text)::bigint)),
  fresh_id,12,2,now(),(SELECT id FROM public.sections LIMIT 1),
  (SELECT id FROM day_actors WHERE role_code='CASHIER'),10,'cosmetic' FROM day_ids;
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('CLV-007',NULL),'fresh_production','Croissant uses production recorded that day');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('CLV-009',NULL),'fresh_production','Chocolatine uses fresh production');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('CLV-001',NULL),'fresh_production','Mini croissant uses fresh production');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('CLV-002',NULL),'fresh_production','Mini chocolatine uses fresh production');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('CLB-005',NULL),'fresh_production','Brown Bread uses fresh production');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('SOU-NEW','sourdough-breads'),'fresh_production','Whole Sourdough category uses fresh production');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('IND-003',NULL),'display','Individual strawberry cheesecake uses display');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('IND-007',NULL),'display','Individual lemon cheesecake uses display');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('IND-013',NULL),'display','Individual passion-fruit cheesecake uses display');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('IND-005',NULL),'display','Opera uses display');
INSERT INTO day_results(tap) SELECT is(stock_private.display_day_reference_basis_v1('CLV-008',NULL),'general','Almond variation is not silently added to fresh exceptions');
INSERT INTO day_results(tap) SELECT is((SELECT expected_qty FROM stock_private.display_day_reference_v1(general_id,current_date)),20::numeric,'Default reference is general stock') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT expected_qty FROM stock_private.display_day_reference_v1(fresh_id,current_date)),10::numeric,'Fresh reference uses the actual good yield, without double-subtracting production waste') FROM day_ids;
-- Le helper de référence display lit le compteur courant sans en modifier le contenu.
INSERT INTO day_results(tap) SELECT is((SELECT expected_qty FROM stock_private.display_day_reference_v1(p.id,current_date)),
 coalesce((SELECT quantity FROM public.display_stock WHERE product_id=p.id),0),'Display exception reads its own counter')
 FROM public.products p WHERE p.sku='IND-005';

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM day_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO day_payload SELECT 'submit',public.submit_display_day_closing_v1(current_date,
 jsonb_build_array(jsonb_build_object('product_id',general_id,'remaining_qty',7,'waste_qty',2,'waste_reason','Discarded at day end'),
 jsonb_build_object('product_id',fresh_id,'remaining_qty',6,'waste_qty',1,'waste_reason','Damaged fresh item'),
 jsonb_build_object('product_id',(SELECT id FROM day_display_baseline),'remaining_qty',31,'waste_qty',0)),submit_key) FROM day_ids;
INSERT INTO day_results(tap) SELECT ok((public.submit_display_day_closing_v1(current_date,
 jsonb_build_array(jsonb_build_object('product_id',general_id,'remaining_qty',7,'waste_qty',2,'waste_reason','Discarded at day end'),
 jsonb_build_object('product_id',fresh_id,'remaining_qty',6,'waste_qty',1,'waste_reason','Damaged fresh item'),
 jsonb_build_object('product_id',(SELECT id FROM day_display_baseline),'remaining_qty',31,'waste_qty',0)),submit_key)->>'idempotent_replay')::boolean,
 'Retry of daily submission is idempotent') FROM day_ids;
INSERT INTO day_payload SELECT 'read',public.get_display_day_closing_v1(current_date);
INSERT INTO day_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'items') x
 WHERE x ? 'expected_qty' OR x ? 'variance' OR x ? 'reference_basis'),'Cashier cannot see theoretical/reference snapshots') FROM day_payload WHERE name='read';
INSERT INTO day_results(tap) SELECT throws_ok(format('SELECT public.submit_display_day_closing_v1(current_date,%L::jsonb,%L::uuid)',
 jsonb_build_array(jsonb_build_object('product_id',general_id,'remaining_qty',8,'waste_qty',2,'waste_reason','Discarded at day end')),submit_key),
 '22023','idempotency_conflict','Changed submission cannot reuse the first key') FROM day_ids;
RESET ROLE;
INSERT INTO day_results(tap) SELECT is((SELECT current_stock FROM public.products WHERE id=general_id),20::numeric,'Remaining count and pending waste never change general stock') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT quantity FROM public.display_stock WHERE product_id=general_id),18::numeric,'Only explicit waste withdraws display quantity') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT current_stock FROM public.products WHERE id=fresh_id),100::numeric,'Fresh remaining count does not regularize frozen general stock') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT quantity FROM public.display_stock WHERE product_id=fresh_id),14::numeric,'Fresh display changes by declared waste only') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT count(*) FROM public.stock_movements WHERE product_id IN(general_id,fresh_id)),0::bigint,'Submitting daily counts creates no global stock movement') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT expected_qty FROM public.display_day_closing_items WHERE closing_id=(SELECT (value->>'closing_id')::uuid FROM day_payload WHERE name='submit') AND product_id=general_id),18::numeric,'General snapshot subtracts pending physical waste exactly once') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT expected_qty FROM public.display_day_closing_items WHERE closing_id=(SELECT (value->>'closing_id')::uuid FROM day_payload WHERE name='submit') AND product_id=fresh_id),9::numeric,'Fresh snapshot subtracts daily waste exactly once') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT expected_qty FROM public.display_day_closing_items WHERE closing_id=(SELECT (value->>'closing_id')::uuid FROM day_payload WHERE name='submit') AND product_id=b.id),30::numeric,'Opera submission freezes display reference only') FROM day_display_baseline b;
INSERT INTO day_results(tap) SELECT is((SELECT quantity FROM public.display_stock WHERE product_id=id),30::numeric,'Informative Opera count does not regularize display') FROM day_display_baseline;
INSERT INTO day_results(tap) SELECT is((SELECT p.current_stock FROM public.products p WHERE p.id=b.id),b.current_stock,'Informative Opera count does not regularize general stock') FROM day_display_baseline b;
SET LOCAL ROLE authenticated;
INSERT INTO day_payload SELECT 'correction',public.correct_display_day_count_v1((SELECT (value->>'closing_id')::uuid FROM day_payload WHERE name='submit'),
 jsonb_build_array(jsonb_build_object('product_id',general_id,'remaining_qty',8),jsonb_build_object('product_id',fresh_id,'remaining_qty',5),
 jsonb_build_object('product_id',(SELECT id FROM day_display_baseline),'remaining_qty',29)),
 'Independent recount corrected entry',correction_key) FROM day_ids;
RESET ROLE;
INSERT INTO day_results(tap) SELECT is((SELECT count(*) FROM public.display_day_closings WHERE business_day=current_date),2::bigint,'Correction adds a revision without overwriting the first');
INSERT INTO day_results(tap) SELECT is((SELECT quantity FROM public.display_stock WHERE product_id=general_id),18::numeric,'Corrected count does not change display') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT current_stock FROM public.products WHERE id=general_id),20::numeric,'Corrected count does not change general stock') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT count(*) FROM public.stock_declarations WHERE product_id IN(general_id,fresh_id)),2::bigint,'Correction never resubmits waste') FROM day_ids;
INSERT INTO day_results(tap) SELECT throws_ok('UPDATE public.display_day_closings SET recorded_at=now()','55000','display_count_is_immutable','Even privileged rewrites of first count are rejected');

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM day_actors WHERE role_code='SUPER_ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO day_payload SELECT 'owner_read',public.get_display_day_closing_v1(current_date);
INSERT INTO day_results(tap) SELECT ok((value->>'is_owner')::boolean AND (value->'items'->0) ? 'expected_qty','Owner sees the frozen theoretical count') FROM day_payload WHERE name='owner_read';
INSERT INTO day_payload SELECT 'approval',public.approve_stock_declaration_v4(i.waste_declaration_id)
 FROM public.get_display_day_closing_v1(current_date) r,
 LATERAL jsonb_to_recordset(r->'items') i(product_id uuid,waste_declaration_id uuid)
 WHERE i.product_id=(SELECT general_id FROM day_ids);
INSERT INTO day_results(tap) SELECT ok((public.approve_stock_declaration_v4((value->>'declaration_id')::uuid)->>'idempotent_replay')::boolean,
 'Owner approval replay produces one global deduction') FROM day_payload WHERE name='approval';
RESET ROLE;
INSERT INTO day_results(tap) SELECT is((SELECT current_stock FROM public.products WHERE id=general_id),18::numeric,'Owner approval applies declared waste to general stock') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT quantity FROM public.display_stock WHERE product_id=general_id),18::numeric,'Owner approval never withdraws display a second time') FROM day_ids;
INSERT INTO day_results(tap) SELECT is((SELECT count(*) FROM public.stock_movements WHERE product_id=general_id),1::bigint,'One approved declaration produces one global ledger entry') FROM day_ids;
SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM day_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
