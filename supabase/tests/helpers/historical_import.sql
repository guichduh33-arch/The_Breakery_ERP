-- Fixtures financieres jetables ; aucune vente, session ou reception persistante.
CREATE TEMP TABLE historical_fixture(auth_id uuid,actor uuid,product uuid,raw_product uuid,customer uuid,corporate uuid,supplier uuid,
 payload jsonb,preview jsonb,result jsonb,client_key uuid,stock_before numeric,notifications_before bigint,sequences_before jsonb);
CREATE TEMP TABLE historical_tap(id integer GENERATED ALWAYS AS IDENTITY,result text);
DO $$
DECLARE a uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); raw_product uuid:=gen_random_uuid();
 c uuid:=gen_random_uuid(); corporate uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); cat uuid:=gen_random_uuid();
 customer_cat uuid:=gen_random_uuid(); corporate_cat uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(p,a,'HIST-'||left(p::text,8),'Historical import pgTAP','SUPER_ADMIN',hash_pin('285741'),true);
 PERFORM pg_temp.authenticate_pin(a);
 INSERT INTO categories(id,name,slug) VALUES(cat,'Historical fixture','historical-'||cat);
 INSERT INTO products(id,sku,name,category_id,retail_price,current_stock,cost_price,unit,track_inventory,deduct_stock,is_display_item)
 VALUES(product,'HIST-'||product,'Historical finished fixture',cat,100,10,20,'pcs',true,false,false),
  (raw_product,'HIST-'||raw_product,'Historical raw fixture',cat,100,10,20,'kg',true,false,false);
 INSERT INTO customer_categories(id,name,slug) VALUES(customer_cat,'Historical retail fixture','historical-'||customer_cat),
  (corporate_cat,'Historical corporate fixture','historical-'||corporate_cat);
 INSERT INTO customers(id,name,customer_type,b2b_credit_limit,category_id) VALUES(c,'Historical retail fixture','retail',NULL,customer_cat),
  (corporate,'Historical corporate fixture','b2b',NULL,corporate_cat);
 INSERT INTO suppliers(id,code,name,payment_terms_days) VALUES(s,'HIST-'||left(s::text,8),'Historical supplier fixture',30);
 INSERT INTO historical_fixture(auth_id,actor,product,raw_product,customer,corporate,supplier,client_key,stock_before,notifications_before)
 VALUES(a,p,product,raw_product,c,corporate,s,gen_random_uuid(),10,(SELECT count(*) FROM notification_outbox));
END $$;
INSERT INTO fiscal_periods(period_start,period_end,status,notes) VALUES
 ('2097-01-01','2097-01-31','open','Historical import fixture'),('2097-02-01','2097-02-28','open','Historical import fixture');
UPDATE business_config SET allow_negative_stock=false WHERE id=1;
UPDATE historical_fixture SET sequences_before=(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY date),'[]') FROM journal_entry_sequences s WHERE date>='2097-01-01');
UPDATE historical_fixture SET payload=jsonb_build_object(
 'contract_version',1,'kind','sales','currency','IDR','source_system','pgtap-historical','batch_reference','sales-1',
 'period_start','2097-01-01','period_end','2097-02-28',
 'source_files',jsonb_build_array(jsonb_build_object('sha256',repeat('a',64),'file_name','fictional.xlsx','sheet_name','Sales')),
 'documents',jsonb_build_array(jsonb_build_object('source_reference','SALE-1','source_sha256',repeat('a',64),'source_row',2,
  'reconciled',true,'document_date','2097-01-10','document_timestamp','2097-01-10T09:12:34+08:00','document_time_precision','timestamp',
  'net_amount',100,'tax_amount',10,'total_amount',110,'discount_amount',0,
  'rounding_amount',0,'tax_source','sales_details_ticket','customer_treatment','retail','customer_id',customer,
  'stock_reconciled',true,'stock_basis','current_v3','lines',jsonb_build_array(jsonb_build_object(
   'source_reference','LINE-1','product_id',product,'quantity',1,'unit','pcs','line_total',110,'unit_price',110,'addon_amount',0,'modifier_ids','[]'::jsonb,'reconciled',true)))),
 'payments',jsonb_build_array(jsonb_build_object('source_reference','PAY-1','source_sha256',repeat('a',64),'source_row',3,
  'reconciled',true,'payment_date','2097-02-02','payment_timestamp','2097-02-02T17:18:19+08:00','payment_time_precision','timestamp',
  'amount',30,'method','cash','allocations',jsonb_build_array(
   jsonb_build_object('document_reference','SALE-1','amount',30)))));
GRANT SELECT,UPDATE ON historical_fixture TO authenticated;
GRANT SELECT,INSERT ON historical_tap TO authenticated;
GRANT USAGE ON SEQUENCE historical_tap_id_seq TO authenticated;
