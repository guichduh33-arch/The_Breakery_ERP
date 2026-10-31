-- Régressions de confidentialité : jours métier, soldes et rejeu de réception.
BEGIN;
\ir helpers/pin_session.sql
\ir helpers/antifraud_actors.sql
SELECT no_plan();
CREATE TEMP TABLE correction_results(seq serial,tap text);
CREATE TEMP TABLE correction_ids AS SELECT gen_random_uuid() product_id,gen_random_uuid() request_key;
CREATE TEMP TABLE correction_actor AS
 SELECT id,auth_user_id FROM user_profiles WHERE id IN(SELECT id FROM antifraud_test_actors)
 AND role_code='ADMIN' AND is_active
 AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
CREATE TEMP TABLE correction_payload(name text PRIMARY KEY,value jsonb);
GRANT ALL ON correction_results,correction_ids,correction_actor,correction_payload TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE correction_results_seq_seq TO authenticated;
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.id,p.code,true,'Transactional migration 60 regression'
 FROM correction_actor a CROSS JOIN permissions p
 WHERE p.code IN ('inventory.receive','inventory.read','reports.inventory.read','inventory.opname.create')
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
INSERT INTO products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit)
 SELECT product_id,'DAY60-'||product_id,'Day boundary regression',
 (SELECT id FROM categories LIMIT 1),1000,0,0,'pcs' FROM correction_ids;
UPDATE business_day_visibility_config SET activated_on=current_date+2;
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM correction_actor));
SET LOCAL ROLE authenticated;
INSERT INTO correction_payload SELECT 'incoming',record_incoming_stock_v4(product_id,5,NULL,0,'Day regression',request_key) FROM correction_ids;
INSERT INTO correction_results(tap) SELECT ok((SELECT value->>'new_current_stock' IS NOT NULL FROM correction_payload WHERE name='incoming'),'Visible reception returns its stock');
INSERT INTO correction_results(tap) SELECT is(jsonb_array_length(get_stock_movements_v5(current_date::text,current_date::text,product_id)->'lines'),1,'Business day includes its reception') FROM correction_ids;
INSERT INTO correction_results(tap) SELECT is(jsonb_array_length(get_stock_movements_v5((current_date-1)::text,(current_date-1)::text,product_id)->'lines'),0,'Previous day excludes current reception') FROM correction_ids;
INSERT INTO correction_results(tap) SELECT is(jsonb_array_length(get_stock_movements_v5((current_date+1)::text,(current_date+1)::text,product_id)->'lines'),0,'Following day excludes current reception') FROM correction_ids;
INSERT INTO correction_results(tap) SELECT is((get_stock_movement_ledger_v3(current_date::text,current_date::text,product_id)->'lines'->0->>'balance_qty')::numeric,5::numeric,'Visible ledger exposes correct balance') FROM correction_ids;
RESET ROLE;
INSERT INTO correction_payload SELECT 'count',create_opname_v3('Day visibility regression',gen_random_uuid(),current_date);
INSERT INTO business_day_releases(day,count_id,released_by)
 SELECT current_date,(value->>'count_id')::uuid,(SELECT id FROM correction_actor)
 FROM correction_payload WHERE name='count'
 ON CONFLICT(day) DO NOTHING;
UPDATE business_day_visibility_config SET activated_on=current_date-1;
DELETE FROM business_day_releases WHERE day=current_date-1;
SET LOCAL ROLE authenticated;
INSERT INTO correction_payload SELECT 'ledger',get_stock_movement_ledger_v3(current_date::text,current_date::text,product_id) FROM correction_ids;
INSERT INTO correction_results(tap) SELECT is(jsonb_array_length(value->'lines'),1,'Released historical lines remain usable') FROM correction_payload WHERE name='ledger';
INSERT INTO correction_results(tap) SELECT is(value->'lines'->0->>'beginning_qty',NULL::text,'Unreleased opening day hides opening balance') FROM correction_payload WHERE name='ledger';
INSERT INTO correction_results(tap) SELECT is(value->'lines'->0->>'balance_qty',NULL::text,'Unreleased opening day hides closing balance') FROM correction_payload WHERE name='ledger';
INSERT INTO correction_results(tap) SELECT throws_ok(format('SELECT get_stock_movements_v5(%L,%L)',current_date-1,current_date),'P0003','business_day_not_released','Range crossing a locked day is refused');
RESET ROLE;
-- Antidater seulement le reçu technique de la fixture ; aucun ledger modifié.
UPDATE stock_private.mutation_requests SET created_at=(current_date-1)::timestamptz
 WHERE idempotency_key=(SELECT request_key FROM correction_ids);
SET LOCAL ROLE authenticated;
INSERT INTO correction_payload SELECT 'replay',record_incoming_stock_v4(product_id,5,NULL,0,'Day regression',request_key) FROM correction_ids;
INSERT INTO correction_results(tap) SELECT ok((value->>'idempotent_replay')::boolean,'Receipt replay remains idempotent') FROM correction_payload WHERE name='replay';
INSERT INTO correction_results(tap) SELECT is(value->>'new_current_stock',NULL::text,'Released today never exposes an unreleased original receipt') FROM correction_payload WHERE name='replay';
RESET ROLE;
INSERT INTO correction_results(tap) SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM correction_ids)),5::numeric,'Replay creates no second stock effect');
INSERT INTO correction_results(tap) SELECT is(stock_private.mask_stock_payload_for_day_v1('{"items":[{"stock_before":8,"quantity":2}],"current_stock":9}'::jsonb,current_date-1),
 '{"items":[{"stock_before":null,"quantity":2}],"current_stock":null}'::jsonb,'Mask traverses nested arrays without hiding declared quantity');
INSERT INTO correction_results(tap) SELECT ok(NOT has_function_privilege('anon','public.get_stock_movements_v5(text,text,uuid,text,integer,text)','EXECUTE'),'Anonymous movements denied');
INSERT INTO correction_results(tap) SELECT ok(NOT has_function_privilege('authenticated','stock_private.mask_stock_payload_for_day_v1(jsonb,date)','EXECUTE'),'Internal mask cannot be called by a client');
INSERT INTO correction_results(tap) SELECT * FROM finish();
SELECT count(*) FILTER(WHERE tap LIKE 'not ok%') failures,jsonb_agg(tap ORDER BY seq) lines FROM correction_results;
ROLLBACK;
