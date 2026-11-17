-- S1-10 / ADR-038 — la finalisation d'inventaire pose le stock à la quantité
-- comptée, et le propriétaire finalise ce qu'il a compté lui-même.
-- DEV sous ROLLBACK.
--
-- Trois produits, tous comptés par le propriétaire, chacun bougé entre l'ajout
-- de la ligne et la finalisation :
--   A : attendu 4, compté 10 (écart +6), puis +3 reçu  -> stock 7 -> final 10 (et non 13)
--   B : attendu 5, compté 3  (écart -2), puis -2 sorti -> stock 3 -> aucun mouvement
--   C : attendu 8, compté 8  (écart 0),  puis -1 sorti -> stock 7 -> +1, final 8
BEGIN;
SET LOCAL statement_timeout='60s';
\ir helpers/pin_session.sql
CREATE TEMP TABLE opname_absolute_results(n serial,tap text) ON COMMIT DROP;
INSERT INTO opname_absolute_results(tap) SELECT plan(17);
DO $test$
DECLARE
  owner_auth uuid:=gen_random_uuid(); owner_profile uuid:=gen_random_uuid();
  counter_auth uuid:=gen_random_uuid(); counter_profile uuid:=gen_random_uuid();
  role_name text:='OPNABS-'||left(gen_random_uuid()::text,8);
  category uuid:=gen_random_uuid();
  prod_a uuid:=gen_random_uuid(); prod_b uuid:=gen_random_uuid(); prod_c uuid:=gen_random_uuid();
  v_count uuid:=gen_random_uuid(); item_a uuid; item_b uuid; item_c uuid;
  result jsonb; replay jsonb; mvt record;
BEGIN
  INSERT INTO auth.users(id) VALUES(owner_auth),(counter_auth);
  INSERT INTO roles(code,name) VALUES(role_name,'Opname absolute counter');
  INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active) VALUES
    (owner_profile,owner_auth,'OPNABS-'||left(owner_profile::text,8),'Opname absolute owner','SUPER_ADMIN',hash_pin('358247'),true),
    (counter_profile,counter_auth,'OPNABS-'||left(counter_profile::text,8),'Opname absolute counter',role_name,hash_pin('358247'),true);
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    VALUES (counter_profile,'inventory.opname.create',true,'Opname absolute fixture');
  PERFORM pg_temp.authenticate_pin(owner_auth);
  INSERT INTO categories(id,name,slug,category_type) VALUES(category,'Opname absolute','opn-abs-'||category,'raw_material');
  INSERT INTO products(id,sku,name,category_id,retail_price,current_stock,cost_price,unit,product_type,is_active,track_inventory,deduct_stock) VALUES
    (prod_a,'OPNABS-A-'||left(prod_a::text,8),'Opname absolute A',category,0,0,1000,'pcs','finished',true,true,true),
    (prod_b,'OPNABS-B-'||left(prod_b::text,8),'Opname absolute B',category,0,0,1000,'pcs','finished',true,true,true),
    (prod_c,'OPNABS-C-'||left(prod_c::text,8),'Opname absolute C',category,0,0,1000,'pcs','finished',true,true,true);
  PERFORM record_stock_movement_v2(p_product_id:=prod_a,p_movement_type:='incoming',p_quantity:=4,p_reason:='Opname absolute seed');
  PERFORM record_stock_movement_v2(p_product_id:=prod_b,p_movement_type:='incoming',p_quantity:=5,p_reason:='Opname absolute seed');
  PERFORM record_stock_movement_v2(p_product_id:=prod_c,p_movement_type:='incoming',p_quantity:=8,p_reason:='Opname absolute seed');

  -- Le propriétaire compte lui-même.
  INSERT INTO inventory_counts(id,count_number,created_by) VALUES(v_count,'OPNABS-'||v_count,owner_profile);
  item_a:=(add_opname_item_v4(v_count,prod_a)->>'item_id')::uuid;
  item_b:=(add_opname_item_v4(v_count,prod_b)->>'item_id')::uuid;
  item_c:=(add_opname_item_v4(v_count,prod_c)->>'item_id')::uuid;
  PERFORM set_opname_count_v3(item_a,10);
  PERFORM set_opname_count_v3(item_b,3);
  PERFORM set_opname_count_v3(item_c,8);
  PERFORM validate_opname_v2(v_count);

  -- Le stock bouge entre l'ajout des lignes et la finalisation.
  PERFORM record_stock_movement_v2(p_product_id:=prod_a,p_movement_type:='incoming',p_quantity:=3,p_reason:='Opname absolute during count');
  PERFORM record_stock_movement_v2(p_product_id:=prod_b,p_movement_type:='adjustment_out',p_quantity:=-2,p_reason:='Opname absolute during count');
  PERFORM record_stock_movement_v2(p_product_id:=prod_c,p_movement_type:='adjustment_out',p_quantity:=-1,p_reason:='Opname absolute during count');

  -- Un compte sans la qualité de propriétaire ne finalise pas.
  PERFORM pg_temp.authenticate_pin(counter_auth);
  INSERT INTO opname_absolute_results(tap)
    SELECT throws_ok(format('SELECT finalize_opname_v7(%L)',v_count),'P0003','forbidden','non-owner cannot finalize');

  PERFORM pg_temp.authenticate_pin(owner_auth);
  INSERT INTO opname_absolute_results(tap)
    SELECT is((SELECT count(*) FROM inventory_count_items WHERE count_id=v_count AND counted_by=owner_profile),
              (SELECT count(*) FROM inventory_count_items WHERE count_id=v_count),'fixture: every line was counted by the owner');
  result:=finalize_opname_v7(v_count);
  replay:=finalize_opname_v7(v_count);

  INSERT INTO opname_absolute_results(tap)
    SELECT is(result->>'status','finalized','owner finalizes a count they counted themselves')
    UNION ALL SELECT is((SELECT current_stock FROM products WHERE id=prod_a),10::numeric,'A: stock equals the counted 10, not 13')
    UNION ALL SELECT is((SELECT current_stock FROM products WHERE id=prod_b),3::numeric,'B: stock equals the counted 3, not 1')
    UNION ALL SELECT is((SELECT current_stock FROM products WHERE id=prod_c),8::numeric,'C: stock equals the counted 8, not 7')
    UNION ALL SELECT is((SELECT variance FROM inventory_count_items WHERE id=item_a),6::numeric,'A: the count-time variance stays on the line')
    UNION ALL SELECT is((SELECT quantity FROM stock_movements WHERE reference_type='opname' AND reference_id=v_count AND product_id=prod_a),3::numeric,'A: the movement applies +3 against the live stock')
    UNION ALL SELECT is((SELECT metadata->>'stock_before' FROM stock_movements WHERE reference_type='opname' AND reference_id=v_count AND product_id=prod_a)::numeric,7::numeric,'A: the movement records the stock read at finalization')
    UNION ALL SELECT is((SELECT metadata->>'count_variance' FROM stock_movements WHERE reference_type='opname' AND reference_id=v_count AND product_id=prod_a)::numeric,6::numeric,'A: the movement keeps the count-time variance')
    UNION ALL SELECT is((SELECT count(*) FROM stock_movements WHERE reference_type='opname' AND reference_id=v_count AND product_id=prod_b),0::bigint,'B: no movement when the live stock already equals the count')
    UNION ALL SELECT is((SELECT movement_type::text||':'||(quantity=1) FROM stock_movements WHERE reference_type='opname' AND reference_id=v_count AND product_id=prod_c),'opname_in:true','C: a zero-variance line still restores the counted stock')
    UNION ALL SELECT is((result->>'movements_emitted')::int,2,'two movements emitted')
    UNION ALL SELECT is(replay->>'idempotent_replay','true','replay returns the existing result')
    UNION ALL SELECT is((SELECT count(*) FROM stock_movements WHERE reference_type='opname' AND reference_id=v_count),2::bigint,'replay emits no extra movement')
    UNION ALL SELECT is((SELECT actor_id::text||':'||(metadata->>'applied_mode') FROM audit_logs WHERE entity_id=v_count AND action='opname.finalize'),owner_profile::text||':absolute','audit records the owner profile and the absolute mode')
    UNION ALL SELECT ok(NOT has_function_privilege('anon','public.finalize_opname_v7(uuid,uuid)','EXECUTE'),'anon cannot execute finalize_opname_v7');
END $test$;
INSERT INTO opname_absolute_results(tap) SELECT * FROM finish();
SELECT jsonb_build_object('target','ikcyvlovptebroadgtvd','observed_at',clock_timestamp(),'tap',(SELECT jsonb_agg(tap ORDER BY n) FROM opname_absolute_results));
ROLLBACK;
