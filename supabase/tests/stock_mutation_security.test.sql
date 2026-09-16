-- Audit stock : effets metier, rejeu durable, cloisonnement des droits.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE TEMP TABLE audit_results(line text);
INSERT INTO audit_results SELECT no_plan();
CREATE TEMP TABLE stock_fixture AS SELECT gen_random_uuid() product_id,
  gen_random_uuid() noop_key, gen_random_uuid() waste_key, gen_random_uuid() incoming_key,
  gen_random_uuid() count_id;
CREATE TEMP TABLE stock_results(name text PRIMARY KEY, result jsonb);
-- Exclure le compte systeme du cron et conserver le meme acteur apres chaque changement.
CREATE TEMP TABLE primary_actor AS SELECT auth_user_id FROM user_profiles
 WHERE role_code='SUPER_ADMIN' AND deleted_at IS NULL
 AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
INSERT INTO audit_results SELECT is((SELECT count(*) FROM primary_actor),1::bigint,'Active authenticated primary actor exists');
INSERT INTO products(id,sku,name,category_id,retail_price,cost_price,unit,current_stock)
SELECT product_id,'AUDIT-' || product_id,'Stock audit fixture',
 (SELECT id FROM categories LIMIT 1),0,0,'pcs',0 FROM stock_fixture;
SELECT set_config('request.jwt.claim.sub',
 (SELECT auth_user_id::text FROM primary_actor),true);
INSERT INTO stock_results SELECT 'noop',public.adjust_stock_v2(product_id,0,'Audit noop',noop_key) FROM stock_fixture;
SELECT public.record_incoming_stock_v2(product_id,5,NULL,NULL,'Audit receipt',NULL) FROM stock_fixture;
INSERT INTO stock_results SELECT 'noop_replay',public.adjust_stock_v2(product_id,0,'Audit noop',noop_key) FROM stock_fixture;
INSERT INTO audit_results SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM stock_fixture)),5::numeric,'No-op replay preserves subsequent receipt');
INSERT INTO audit_results SELECT is((SELECT result->>'new_current_stock' FROM stock_results WHERE name='noop_replay'),'0.000','No-op replay returns original stock');
INSERT INTO audit_results SELECT ok((SELECT (result->>'idempotent_replay')::boolean FROM stock_results WHERE name='noop_replay'),'No-op result is durable');
INSERT INTO stock_results SELECT 'waste',public.waste_stock_v2(product_id,5,'Audit waste',waste_key) FROM stock_fixture;
INSERT INTO stock_results SELECT 'waste_replay',public.waste_stock_v2(product_id,5,'Audit waste',waste_key) FROM stock_fixture;
INSERT INTO audit_results SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM stock_fixture)),0::numeric,'Waste retry succeeds after stock exhausted');
INSERT INTO audit_results SELECT is((SELECT result->>'movement_id' FROM stock_results WHERE name='waste'),(SELECT result->>'movement_id' FROM stock_results WHERE name='waste_replay'),'Waste retry returns original movement');
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.waste_stock_v2(%L,4,%L,%L)',product_id,'Audit waste',waste_key),
 '22023','idempotency_conflict','Changed quantity cannot reuse key') FROM stock_fixture;
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.adjust_stock_v2(%L,5,%L,%L)',product_id,'Audit waste',waste_key),
 '22023','idempotency_conflict','Other operation cannot reuse key') FROM stock_fixture;
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.waste_stock_v2(%L,5,%L,%L)',product_id,'Changed reason',waste_key),
 '22023','idempotency_conflict','Changed reason cannot reuse key') FROM stock_fixture;
INSERT INTO stock_results SELECT 'incoming',public.record_incoming_stock_v2(product_id,3,NULL,NULL,'Audit durable receipt',incoming_key) FROM stock_fixture;
SELECT public.waste_stock_v2(product_id,1,'Audit intervening waste',NULL) FROM stock_fixture;
INSERT INTO stock_results SELECT 'incoming_replay',public.record_incoming_stock_v2(product_id,3,NULL,NULL,'Audit durable receipt',incoming_key) FROM stock_fixture;
INSERT INTO audit_results SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM stock_fixture)),2::numeric,'Incoming retry preserves intervening waste');
INSERT INTO audit_results SELECT is((SELECT (result->>'new_current_stock')::numeric FROM stock_results WHERE name='incoming_replay'),3::numeric,'Incoming retry returns original stock');
INSERT INTO audit_results SELECT is((SELECT count(*) FROM stock_movements WHERE idempotency_key=(SELECT incoming_key FROM stock_fixture)),1::bigint,'Incoming key creates one movement');
-- Second acteur explicitement autorise dans la transaction, independamment de sa matrice.
CREATE TEMP TABLE second_actor AS SELECT id,auth_user_id FROM user_profiles
 WHERE deleted_at IS NULL AND is_active AND role_code <> 'SUPER_ADMIN'
 AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
INSERT INTO audit_results SELECT is((SELECT count(*) FROM second_actor),1::bigint,'Second actor fixture exists');
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason,expires_at)
 SELECT id,'inventory.receive',true,'Stock audit second actor',NULL FROM second_actor
 ON CONFLICT (user_profile_id,permission_code) DO UPDATE
 SET is_granted=true,reason=EXCLUDED.reason,expires_at=NULL;
SELECT set_config('request.jwt.claim.sub',(SELECT auth_user_id::text FROM second_actor),true);
GRANT ALL ON audit_results,stock_fixture TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO audit_results SELECT ok(has_permission(auth.uid(),'inventory.receive'),'Second actor is authorized to receive');
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.record_incoming_stock_v2(%L,3,NULL,NULL,%L,%L)',product_id,'Audit durable receipt',incoming_key),
 '22023','idempotency_conflict','Authorized second actor cannot reuse original actor key') FROM stock_fixture;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',
 (SELECT auth_user_id::text FROM primary_actor),true);
INSERT INTO audit_results SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM stock_fixture)),2::numeric,'Actor conflict leaves stock unchanged');
INSERT INTO audit_results SELECT is((SELECT count(*) FROM stock_movements WHERE idempotency_key=(SELECT incoming_key FROM stock_fixture)),1::bigint,'Actor conflict leaves ledger unchanged');
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.adjust_stock_v2(%L,NULL,%L,NULL)',product_id,'Audit invalid'),
 '22023','invalid_quantity','Null quantity rejected') FROM stock_fixture;
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.record_incoming_stock_v2(%L,%L,NULL,NULL,NULL,NULL)',product_id,'NaN'),
 '22023','invalid_quantity','NaN quantity rejected') FROM stock_fixture;
INSERT INTO audit_results SELECT ok(NOT has_column_privilege('authenticated','products','current_stock','UPDATE'),'Stock column rejects direct UPDATE');
INSERT INTO audit_results SELECT ok(NOT has_column_privilege('authenticated','products','unit','UPDATE'),'Unit column rejects direct UPDATE');
INSERT INTO audit_results SELECT ok(NOT has_column_privilege('authenticated','products','current_stock','INSERT'),'Initial stock rejects direct INSERT');
INSERT INTO audit_results SELECT ok(NOT has_schema_privilege('authenticated','stock_private','USAGE'),'Request registry schema is private');
INSERT INTO audit_results SELECT ok(NOT has_table_privilege('authenticated','stock_movements','INSERT,UPDATE,DELETE,TRUNCATE'),'Ledger remains append-only to clients');
INSERT INTO audit_results SELECT ok(NOT has_function_privilege('anon','public.adjust_stock_v2(uuid,numeric,text,uuid)','EXECUTE'),'Anon cannot adjust');
INSERT INTO audit_results SELECT ok(NOT has_function_privilege('anon','public.waste_stock_v2(uuid,numeric,text,uuid)','EXECUTE'),'Anon cannot waste');
INSERT INTO audit_results SELECT ok(NOT has_function_privilege('anon','public.record_incoming_stock_v2(uuid,numeric,uuid,numeric,text,uuid)','EXECUTE'),'Anon cannot receive');
INSERT INTO audit_results SELECT ok(to_regprocedure('public.adjust_stock_v1(uuid,numeric,text,uuid)') IS NULL,'Old adjust API removed');
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.adjust_stock_v2(%L,2,%L,NULL)',product_id,'ab'),
 NULL,'reason_required','No-op adjustment still requires reason') FROM stock_fixture;
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.record_incoming_stock_v2(%L,0.0001,NULL,NULL,NULL,NULL)',product_id),
 '22023','invalid_quantity_precision','Sub-millibase quantity rejected') FROM stock_fixture;
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.adjust_stock_v2(%L,10000000,%L,NULL)',product_id,'Audit overflow'),
 '22023','invalid_quantity_precision','Quantity outside storage range rejected') FROM stock_fixture;
UPDATE products SET deleted_at=now() WHERE id=(SELECT product_id FROM stock_fixture);
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.record_incoming_stock_v2(%L,1,NULL,NULL,NULL,NULL)',product_id),
 'P0002','product_not_found','New movement cannot target deleted product') FROM stock_fixture;
INSERT INTO audit_results SELECT lives_ok(
 format('SELECT public.record_incoming_stock_v2(%L,3,NULL,NULL,%L,%L)',product_id,'Audit durable receipt',incoming_key),
 'Original receipt remains replayable after product deletion') FROM stock_fixture;
-- Un JWT sans profil ne dispose d'aucune permission ; tester les vraies policies.
INSERT INTO inventory_counts(id,count_number,created_by)
 SELECT count_id,'AUDIT-' || count_id,
 (SELECT id FROM user_profiles WHERE auth_user_id=auth.uid() AND deleted_at IS NULL LIMIT 1) FROM stock_fixture;
INSERT INTO inventory_count_items(count_id,product_id,expected_qty,counted_qty,unit)
 SELECT count_id,product_id,2,2,'pcs' FROM stock_fixture;
GRANT ALL ON audit_results,stock_fixture TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO audit_results SELECT is((SELECT count(*) FROM public.inventory_counts WHERE id=(SELECT count_id FROM stock_fixture)),1::bigint,'Authorized reader sees fixture header');
INSERT INTO audit_results SELECT is((SELECT count(*) FROM public.inventory_count_items WHERE count_id=(SELECT count_id FROM stock_fixture)),1::bigint,'Authorized reader sees fixture item');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO audit_results SELECT is((SELECT count(*) FROM public.inventory_counts WHERE id=(SELECT count_id FROM stock_fixture)),0::bigint,'Fixture header hidden without inventory.read');
INSERT INTO audit_results SELECT is((SELECT count(*) FROM public.inventory_count_items WHERE count_id=(SELECT count_id FROM stock_fixture)),0::bigint,'Fixture item hidden without inventory.read');
INSERT INTO audit_results SELECT throws_ok(
 format('SELECT public.adjust_stock_v2(%L,0,%L,%L)',product_id,'Audit noop',noop_key),
 'P0003','forbidden','Permission checked before replay') FROM stock_fixture;
RESET ROLE;
-- Exact regression: a fractional no-op, an intervening outgoing movement, then replay.
SELECT set_config('request.jwt.claim.sub',
 (SELECT auth_user_id::text FROM primary_actor),true);
CREATE TEMP TABLE decrement_fixture AS SELECT gen_random_uuid() product_id,gen_random_uuid() request_key;
INSERT INTO products(id,sku,name,category_id,retail_price,cost_price,unit,current_stock)
 SELECT product_id,'AUDIT-KG-' || product_id,'Fractional stock audit fixture',
 (SELECT id FROM categories LIMIT 1),0,0,'kg',0 FROM decrement_fixture;
SELECT public.record_incoming_stock_v2(product_id,1.375,NULL,NULL,'Fractional fixture',NULL) FROM decrement_fixture;
INSERT INTO stock_results SELECT 'kg_noop',public.adjust_stock_v2(product_id,1.375,'Fractional no-op',request_key) FROM decrement_fixture;
SELECT public.waste_stock_v2(product_id,0.375,'Fractional outgoing',NULL) FROM decrement_fixture;
INSERT INTO stock_results SELECT 'kg_replay',public.adjust_stock_v2(product_id,1.375,'Fractional no-op',request_key) FROM decrement_fixture;
INSERT INTO audit_results SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM decrement_fixture)),1::numeric,'No-op replay never recreates outgoing stock');
INSERT INTO audit_results SELECT is((SELECT (result->>'new_current_stock')::numeric FROM stock_results WHERE name='kg_replay'),1.375::numeric,'Fractional replay returns original count');
INSERT INTO audit_results SELECT is((SELECT count(*) FROM stock_movements WHERE idempotency_key=(SELECT request_key FROM decrement_fixture)),0::bigint,'No-op creates no artificial ledger movement');
INSERT INTO audit_results SELECT is((SELECT unit FROM stock_movements WHERE product_id=(SELECT product_id FROM decrement_fixture) AND movement_type='waste'),'kg','Fractional waste preserves base unit');
INSERT INTO audit_results SELECT * FROM finish();
SELECT array_agg(line) AS results FROM audit_results;
ROLLBACK;
