CREATE TEMP TABLE historical_fixture(auth_id uuid,actor uuid,product uuid,customer uuid,corporate uuid,
 payload jsonb,preview jsonb,result jsonb,client_key uuid);
CREATE TEMP TABLE historical_tap(id integer GENERATED ALWAYS AS IDENTITY,result text);
DO $$ DECLARE a uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); cat uuid:=gen_random_uuid(); BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(p,a,'CA-'||left(p::text,8),'Customer advances fixture','SUPER_ADMIN',hash_pin('285741'),true);
 PERFORM pg_temp.authenticate_pin(a);
 INSERT INTO categories(id,name,slug) VALUES(cat,'Customer advances fixture','ca-'||cat);
 INSERT INTO customer_categories(id,name,slug) VALUES(c,'Advance fixture','ca-'||c);
 INSERT INTO products(sku,name,category_id,retail_price,current_stock,cost_price,unit,track_inventory,deduct_stock)
 VALUES('CA-'||p,'Advance fixture',cat,100000,10,20,'pcs',true,false);
 INSERT INTO customers(name,customer_type,category_id) VALUES('Advance B2B fixture','b2b',c),('Advance retail fixture','retail',c);
 INSERT INTO historical_fixture(auth_id,actor,product,customer,corporate,client_key,payload)
 SELECT a,p,(SELECT id FROM products WHERE sku='CA-'||p),
 (SELECT id FROM customers WHERE category_id=c AND customer_type='retail'),
 (SELECT id FROM customers WHERE category_id=c AND customer_type='b2b'),gen_random_uuid(),jsonb_build_object(
 'contract_version',1,'kind','sales','currency','IDR','source_system','pgtap-ca-'||p,'batch_reference','advances',
 'period_start','2097-01-01','period_end','2097-01-31','source_files',jsonb_build_array(
 jsonb_build_object('sha256',repeat('a',64),'file_name','fixture.xlsx','sheet_name','Sales')));
END $$;
INSERT INTO fiscal_periods(period_start,period_end,status,notes) VALUES('2097-01-01','2097-01-31','open','Customer advance test');
GRANT SELECT,UPDATE ON historical_fixture TO authenticated;
GRANT SELECT,INSERT ON historical_tap TO authenticated;
GRANT USAGE ON SEQUENCE historical_tap_id_seq TO authenticated;
