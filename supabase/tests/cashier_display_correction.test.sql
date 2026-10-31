-- Correction vitrine immédiate : rôle réel, quantité globale intacte et réponse sans oracle de no-op.
BEGIN;
\ir helpers/pin_session.sql
CREATE TEMP TABLE display_guard_results(seq serial,tap text);
SELECT no_plan();
CREATE TEMP TABLE display_guard_ids AS SELECT gen_random_uuid() product_id,gen_random_uuid() other_product,
 gen_random_uuid() actor_id,gen_random_uuid() actor_uid,gen_random_uuid() denied_id,gen_random_uuid() denied_uid,
 gen_random_uuid() first_key,gen_random_uuid() noop_key,gen_random_uuid() next_key,gen_random_uuid() final_key;
CREATE TEMP TABLE display_guard_payload(name text PRIMARY KEY,value jsonb);
GRANT ALL ON display_guard_results,display_guard_ids,display_guard_payload TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE display_guard_results_seq_seq TO authenticated;
INSERT INTO auth.users(id,email) SELECT actor_uid,actor_uid||'@display-guard.invalid' FROM display_guard_ids
 UNION ALL SELECT denied_uid,denied_uid||'@display-guard.invalid' FROM display_guard_ids;
INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code)
 SELECT actor_id,actor_uid,'DISPLAY-'||actor_id,'Display cashier fixture','invalid-fixture-hash','CASHIER' FROM display_guard_ids
 UNION ALL SELECT denied_id,denied_uid,'DISPLAY-'||denied_id,'Display denied fixture','invalid-fixture-hash','CASHIER' FROM display_guard_ids;
-- Le caissier passant ne reçoit aucun override ; la migration doit accorder son rôle.
INSERT INTO display_guard_results(tap) SELECT is((SELECT count(*) FROM user_permission_overrides WHERE user_profile_id=(SELECT actor_id FROM display_guard_ids)),0::bigint,'Cashier success relies on role grant, without override');
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT denied_id,'display.manage',false,'Explicit denied test user' FROM display_guard_ids;
UPDATE business_day_visibility_config SET activated_on=current_date;
DELETE FROM business_day_releases WHERE day=current_date;
INSERT INTO products(id,sku,name,category_id,retail_price,current_stock,unit,is_display_item)
 SELECT product_id,'DISPLAY-'||product_id,'Immediate display fixture',(SELECT id FROM categories LIMIT 1),1000,11,'pcs',true FROM display_guard_ids
 UNION ALL SELECT other_product,'DISPLAY-'||other_product,'Non display fixture',(SELECT id FROM categories LIMIT 1),1000,50,'pcs',false FROM display_guard_ids;
UPDATE display_stock SET quantity=5 WHERE product_id=(SELECT product_id FROM display_guard_ids);
SELECT pg_temp.authenticate_pin((SELECT actor_uid FROM display_guard_ids));
SET LOCAL ROLE authenticated;
INSERT INTO display_guard_results(tap) SELECT ok(has_permission(auth.uid(),'display.manage'),'Cashier role has display.manage');
INSERT INTO display_guard_results(tap) SELECT ok(NOT can_view_business_day_v1(current_date),'Current day is locked for cashier');
INSERT INTO display_guard_payload SELECT 'first',adjust_display_stock_v5(product_id,7,'Physical shelf recount',first_key) FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT is((SELECT value->>'new_display_stock' FROM display_guard_payload WHERE name='first'),NULL::text,'Immediate correction keeps returned exact stock hidden');
INSERT INTO display_guard_results(tap) SELECT ok((SELECT value->>'effect_id' IS NOT NULL FROM display_guard_payload WHERE name='first'),'Applied operation has an opaque effect identifier');
INSERT INTO display_guard_results(tap) SELECT is((SELECT count(*) FROM jsonb_object_keys((SELECT value FROM display_guard_payload WHERE name='first'))),4::bigint,'Hidden response exposes only the approved four fields');
RESET ROLE;
INSERT INTO display_guard_results(tap) SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT product_id FROM display_guard_ids)),7::numeric,'Cashier changes shelf quantity immediately');
INSERT INTO display_guard_results(tap) SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM display_guard_ids)),11::numeric,'Global stock is unchanged');
INSERT INTO display_guard_results(tap) SELECT is((SELECT count(*) FROM stock_movements WHERE product_id=(SELECT product_id FROM display_guard_ids)),0::bigint,'No global ledger movement is emitted');
INSERT INTO display_guard_results(tap) SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE entity_id=(SELECT (value->>'effect_id')::uuid FROM display_guard_payload WHERE name='first') AND action='display.adjust' AND actor_id=(SELECT actor_id FROM display_guard_ids)),'Audit stores profile ID distinct from auth UID');
INSERT INTO display_guard_results(tap) SELECT is((SELECT quantity FROM display_movements WHERE id=(SELECT (value->>'effect_id')::uuid FROM display_guard_payload WHERE name='first')),2::numeric,'Display ledger records the signed delta');
SET LOCAL ROLE authenticated;
SELECT adjust_display_stock_v5(product_id,9,'Later shelf recount',next_key) FROM display_guard_ids;
INSERT INTO display_guard_payload SELECT 'first_replay',adjust_display_stock_v5(product_id,7,'Physical shelf recount',first_key) FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT is((SELECT value->>'effect_id' FROM display_guard_payload WHERE name='first_replay'),(SELECT value->>'effect_id' FROM display_guard_payload WHERE name='first'),'Retry returns the original effect ID');
INSERT INTO display_guard_results(tap) SELECT ok((SELECT (value->>'idempotent_replay')::boolean FROM display_guard_payload WHERE name='first_replay'),'Retry is identified as replay');
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,8,%L,%L)',product_id,'Physical shelf recount',first_key),'22023','idempotency_conflict','Changed quantity cannot reuse key') FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,7,%L,%L)',product_id,'Different reason',first_key),'22023','idempotency_conflict','Changed reason cannot reuse key') FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,7,%L,%L)',other_product,'Physical shelf recount',first_key),'22023','idempotency_conflict','Changed product cannot reuse key') FROM display_guard_ids;
INSERT INTO display_guard_payload SELECT 'noop',adjust_display_stock_v5(product_id,9,'Same physical shelf count',noop_key) FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT is((SELECT count(*) FROM jsonb_object_keys((SELECT value FROM display_guard_payload WHERE name='noop'))),4::bigint,'No-op has the same hidden response shape');
INSERT INTO display_guard_results(tap) SELECT ok(NOT ((SELECT value FROM display_guard_payload WHERE name='noop') ?| ARRAY['noop','delta','previous_qty','display_movement_id']),'No-op status and absence of ledger row cannot reveal old stock');
SELECT adjust_display_stock_v5(product_id,4,'Subsequent shelf recount',final_key) FROM display_guard_ids;
INSERT INTO display_guard_payload SELECT 'noop_replay',adjust_display_stock_v5(product_id,9,'Same physical shelf count',noop_key) FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT is((SELECT value->>'effect_id' FROM display_guard_payload WHERE name='noop_replay'),(SELECT value->>'effect_id' FROM display_guard_payload WHERE name='noop'),'No-op retry retains its opaque effect');
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,-1,%L,%L)',product_id,'Invalid count',gen_random_uuid()),'22023','invalid_quantity','Negative quantities rejected') FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,%L::numeric,%L,%L)',product_id,'NaN','Invalid count',gen_random_uuid()),'22023','invalid_quantity','Non-finite quantities rejected') FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,1.0001,%L,%L)',product_id,'Invalid precision',gen_random_uuid()),'22023','invalid_quantity','Excess precision rejected') FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,1,%L,%L)',product_id,'no',gen_random_uuid()),'P0001','reason_required','Reason is required') FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,1,%L,NULL)',product_id,'Missing key'),'22023','idempotency_key_required','Request key is required') FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,1,%L,%L)',other_product,'Wrong product',gen_random_uuid()),'P0002','not_a_display_item','Only display items are accepted') FROM display_guard_ids;
RESET ROLE;
INSERT INTO display_guard_results(tap) SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT product_id FROM display_guard_ids)),4::numeric,'Retries never recreate a later shelf quantity');
INSERT INTO display_guard_results(tap) SELECT is((SELECT count(*) FROM display_movements WHERE product_id=(SELECT product_id FROM display_guard_ids)),3::bigint,'No-op and retries create no artificial ledger rows');
-- Simule la lecture d'un jour visible pour contrôler le résultat durable, sans libération réelle.
UPDATE business_day_visibility_config SET activated_on=current_date+1;
SET LOCAL ROLE authenticated;
INSERT INTO display_guard_payload SELECT 'visible_replay',adjust_display_stock_v5(product_id,7,'Physical shelf recount',first_key) FROM display_guard_ids;
INSERT INTO display_guard_results(tap) SELECT is((SELECT (value->>'new_display_stock')::numeric FROM display_guard_payload WHERE name='visible_replay'),7::numeric,'Visible replay returns original result rather than present stock');
RESET ROLE;
SELECT pg_temp.authenticate_pin((SELECT denied_uid FROM display_guard_ids));
SET LOCAL ROLE authenticated;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,99,%L,%L)',product_id,'Forbidden correction',gen_random_uuid()),'P0003','forbidden','Explicit user deny still overrides the cashier role grant') FROM display_guard_ids;
RESET ROLE;
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM user_profiles WHERE role_code='SUPER_ADMIN' AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1));
SET LOCAL ROLE authenticated;
INSERT INTO display_guard_results(tap) SELECT throws_ok(format('SELECT adjust_display_stock_v5(%L,7,%L,%L)',product_id,'Physical shelf recount',first_key),'22023','idempotency_conflict','Another authorized actor cannot reuse the key') FROM display_guard_ids;
RESET ROLE;
INSERT INTO display_guard_results(tap) SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product_id FROM display_guard_ids)),11::numeric,'Every display correction leaves global stock unchanged');
INSERT INTO display_guard_results(tap) SELECT is((SELECT count(*) FROM stock_declarations WHERE product_id=(SELECT product_id FROM display_guard_ids)),0::bigint,'Immediate shelf corrections create no owner declaration');
INSERT INTO display_guard_results(tap) SELECT ok(NOT has_function_privilege('anon','public.adjust_display_stock_v5(uuid,numeric,text,uuid)','EXECUTE'),'Anonymous execution is denied');
INSERT INTO display_guard_results(tap) SELECT ok(NOT has_schema_privilege('authenticated','stock_private','USAGE'),'Durable request registry remains private');
INSERT INTO display_guard_results(tap) SELECT ok(to_regprocedure('public.adjust_display_stock_v3(uuid,numeric,text,uuid)') IS NULL AND to_regprocedure('public.adjust_display_stock_v4(uuid,numeric,text,uuid)') IS NULL,'Replaced display correction endpoints are removed');
INSERT INTO display_guard_results(tap) SELECT * FROM finish();
SELECT count(*) FILTER(WHERE tap LIKE 'not ok%') failures,jsonb_agg(tap ORDER BY seq) lines FROM display_guard_results;
ROLLBACK;
