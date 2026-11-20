-- Compteur non suivi immobile ; le ledger porte toujours le coût de la vente.
-- Un changement de suivi ne bloque pas l'annulation et n'ajoute aucune compensation.
BEGIN;
\ir helpers/pin_session.sql
CREATE TEMP TABLE untracked_checks(name text,passed boolean);
DO $test$
DECLARE a uuid:=gen_random_uuid();u uuid:=gen_random_uuid();c uuid;p uuid;o uuid;k uuid;r jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(u);
 INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(a,u,'S115-U-'||left(a::text,8),'Untracked B2B fixture','SUPER_ADMIN',hash_pin('273849'),true);
 PERFORM pg_temp.authenticate_pin(u);
 INSERT INTO customers(name,customer_type,b2b_credit_limit,b2b_current_balance)
 VALUES('Untracked B2B fixture','b2b',NULL,0) RETURNING id INTO c;
 INSERT INTO products(sku,name,category_id,retail_price,current_stock,cost_price,track_inventory,deduct_stock,is_display_item,unit)
 VALUES('S115-U-'||gen_random_uuid(),'Untracked B2B fixture',(SELECT id FROM categories LIMIT 1),10000,7,1000,false,false,true,'pcs') RETURNING id INTO p;
 UPDATE display_stock SET quantity=0 WHERE product_id=p;
 r:=create_b2b_order_v11(c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',3)),NULL,NULL,gen_random_uuid());o:=(r->>'order_id')::uuid;
 INSERT INTO untracked_checks VALUES('no untracked movement at creation',NOT EXISTS(SELECT 1 FROM stock_movements WHERE reference_id=o));
 PERFORM update_b2b_pickup_v4(o,NULL,true);
 INSERT INTO untracked_checks SELECT 'untracked pickup keeps counter',current_stock=7 FROM products WHERE id=p;
 INSERT INTO untracked_checks SELECT 'untracked pickup writes sale ledger',count(*)=1 AND sum(quantity)=-3 FROM stock_movements WHERE reference_id=o AND movement_type='sale';
 INSERT INTO untracked_checks SELECT 'untracked pickup emits COGS',count(*)=1 AND sum(j.total_debit)=3000
 FROM stock_movements sm JOIN journal_entries j ON j.reference_type='stock_movement' AND j.reference_id=sm.id WHERE sm.reference_id=o;
 k:=gen_random_uuid();PERFORM cancel_b2b_order_v5(o,'Untracked cancellation',k);
 INSERT INTO untracked_checks SELECT 'untracked cancellation keeps counter',current_stock=7 FROM products WHERE id=p;
 INSERT INTO untracked_checks SELECT 'untracked cancellation restores ledger quantities',sum(quantity)=0 AND count(*)=2 FROM stock_movements WHERE reference_id=o;
 r:=cancel_b2b_order_v5(o,'Untracked cancellation',k);
 INSERT INTO untracked_checks VALUES('untracked cancellation replay is stock neutral',(r->>'idempotent_replay')::boolean
  AND (SELECT count(*)=2 FROM stock_movements WHERE reference_id=o));
 INSERT INTO untracked_checks SELECT 'untracked B2B never changes vitrine',quantity=0
  AND NOT EXISTS(SELECT 1 FROM display_movements WHERE reference_id=o) FROM display_stock WHERE product_id=p;

 UPDATE products SET track_inventory=true,current_stock=7 WHERE id=p;
 r:=create_b2b_order_v11(c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',3)),NULL,NULL,gen_random_uuid());o:=(r->>'order_id')::uuid;
 PERFORM update_b2b_pickup_v4(o,NULL,true);
 UPDATE products SET track_inventory=false WHERE id=p;
 k:=gen_random_uuid();PERFORM cancel_b2b_order_v5(o,'Tracking disabled after pickup',k);
 INSERT INTO untracked_checks SELECT 'true to false cancellation does not move untracked counter',current_stock=4 FROM products WHERE id=p;
 INSERT INTO untracked_checks SELECT 'true to false cancellation restores ledger only',sum(quantity)=0 FROM stock_movements WHERE reference_id=o;
 r:=cancel_b2b_order_v5(o,'Tracking disabled after pickup',k);
 INSERT INTO untracked_checks SELECT 'true to false replay preserves counter',current_stock=4 AND (r->>'idempotent_replay')::boolean FROM products WHERE id=p;

 r:=create_b2b_order_v11(c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',3)),NULL,NULL,gen_random_uuid());o:=(r->>'order_id')::uuid;
 PERFORM update_b2b_pickup_v4(o,NULL,true);
 UPDATE products SET track_inventory=true WHERE id=p;
 k:=gen_random_uuid();PERFORM cancel_b2b_order_v5(o,'Tracking enabled after pickup',k);
 INSERT INTO untracked_checks SELECT 'false to true cancellation follows current tracked counter policy',current_stock=7 FROM products WHERE id=p;
 INSERT INTO untracked_checks SELECT 'false to true cancellation restores ledger quantities',sum(quantity)=0 FROM stock_movements WHERE reference_id=o;
 r:=cancel_b2b_order_v5(o,'Tracking enabled after pickup',k);
 INSERT INTO untracked_checks SELECT 'false to true replay never adds compensation',current_stock=7 AND (r->>'idempotent_replay')::boolean FROM products WHERE id=p;
END $test$;
CREATE TEMP TABLE untracked_tap(seq serial,line text);
INSERT INTO untracked_tap(line) SELECT plan((SELECT count(*)::integer FROM untracked_checks));
INSERT INTO untracked_tap(line) SELECT ok(passed,name) FROM untracked_checks;
INSERT INTO untracked_tap(line) SELECT * FROM finish();
SELECT line FROM untracked_tap ORDER BY seq;
ROLLBACK;
