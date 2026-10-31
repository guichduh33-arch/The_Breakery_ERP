-- Acteurs et produits privés à la transaction appelante, sans PIN réel ni effet durable.
\ir pin_session.sql
CREATE TEMP TABLE loss_actors(kind text PRIMARY KEY,id uuid DEFAULT gen_random_uuid(),uid uuid DEFAULT gen_random_uuid());
INSERT INTO loss_actors(kind) VALUES('cashier'),('owner'),('denied');
INSERT INTO auth.users(id,email) SELECT uid,uid||'@loss-guard.invalid' FROM loss_actors;
INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code)
 SELECT id,uid,'LOSS-GUARD-'||id,'Loss guard '||kind,'invalid-fixture-hash',
 CASE WHEN kind='owner' THEN 'SUPER_ADMIN' ELSE 'CASHIER' END FROM loss_actors;
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT id,'display.manage',false,'Explicit transactional deny' FROM loss_actors WHERE kind='denied';
CREATE TEMP TABLE loss_products(kind text PRIMARY KEY,id uuid DEFAULT gen_random_uuid(),key uuid DEFAULT gen_random_uuid());
INSERT INTO loss_products(kind) VALUES('main'),('rejected'),('legacy'),('owner'),('sale_first'),('loss_first'),('missing'),('non_display');
INSERT INTO products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit,is_display_item)
 SELECT id,'LOSS-GUARD-'||id,'Loss guard '||kind,(SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1),
 1000,0,10,'pcs',kind<>'non_display' FROM loss_products;
UPDATE display_stock SET quantity=10 WHERE product_id IN(SELECT id FROM loss_products);
CREATE TEMP TABLE loss_payload(name text PRIMARY KEY,value jsonb);
CREATE TEMP TABLE loss_results(seq serial,tap text);
GRANT ALL ON loss_actors,loss_products,loss_payload,loss_results TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE loss_results_seq_seq TO authenticated;
UPDATE business_day_visibility_config SET activated_on=current_date;
DELETE FROM business_day_releases WHERE day=current_date;
SELECT no_plan();
