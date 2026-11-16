-- Fixtures de métadonnées uniquement, incluses après BEGIN ; aucun octet téléversé.
\ir expense_terms.sql
\ir pin_session.sql
CREATE TEMP TABLE inf_actor(kind text PRIMARY KEY,auth_id uuid,profile_id uuid);
INSERT INTO inf_actor SELECT k,gen_random_uuid(),gen_random_uuid()
 FROM unnest(ARRAY['owner','manager','payer','stranger']) k;
INSERT INTO auth.users(id) SELECT auth_id FROM inf_actor;
INSERT INTO user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
 SELECT profile_id,auth_id,'CASHIER','INF-'||left(profile_id::text,8),
 'Invoice forward '||kind,hash_pin('285741'),true FROM inf_actor;
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.profile_id,p.code,
  (a.kind='owner' AND p.code IN('expenses.create','expenses.read','purchasing.po.create','purchasing.po.read','purchasing.po.pay'))
  OR (a.kind='manager' AND p.code IN('expenses.manage','expenses.pay','expenses.read','purchasing.po.pay','purchasing.po.read'))
  OR (a.kind='payer' AND p.code IN('expenses.pay','expenses.read')),
 'Transactional invoice forward fixture' FROM inf_actor a CROSS JOIN permissions p
 WHERE p.code LIKE 'expenses.%' OR p.code LIKE 'purchasing.po.%';
CREATE TEMP TABLE inf_state(tag text PRIMARY KEY,id uuid DEFAULT gen_random_uuid(),path text,result jsonb);
WITH a AS(INSERT INTO accounts(code,name,account_class,account_type,balance_type)
 VALUES('INF-'||gen_random_uuid(),'Invoice forward charge',6,'expense','debit') RETURNING id),
 c AS(INSERT INTO expense_categories(code,name,account_id)
 SELECT 'INF-'||gen_random_uuid(),'Invoice forward category',id FROM a RETURNING id)
 INSERT INTO inf_state(tag,id) SELECT 'category',id FROM c;
WITH s AS(INSERT INTO suppliers(code,name,is_active)
 VALUES('INF-'||gen_random_uuid(),'Invoice forward supplier',true) RETURNING id)
 INSERT INTO inf_state(tag,id) SELECT 'supplier',id FROM s;
CREATE FUNCTION pg_temp.invoice_expense(p_tag text,p_status text DEFAULT 'draft',p_method text DEFAULT 'transfer')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_category uuid; BEGIN
 SELECT id INTO v_category FROM inf_state WHERE tag='category';
 INSERT INTO expenses(id,expense_number,category_id,amount,payment_method,description,
  expense_date,status,created_by,expense_term_id)
 SELECT v_id,'INF-'||v_id,v_category,100,p_method,'Invoice forward',CURRENT_DATE,p_status,profile_id,
  pg_temp.expense_term_fixture(v_category,'Invoice forward') FROM inf_actor WHERE kind='owner';
 INSERT INTO inf_state(tag,id) VALUES(p_tag,v_id);
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION pg_temp.invoice_expense(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION pg_temp.invoice_po(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid:=gen_random_uuid(); BEGIN
 INSERT INTO purchase_orders(id,po_number,supplier_id,status,payment_terms,subtotal,total_amount,created_by)
 SELECT v_id,'INF-'||v_id,s.id,'pending','credit',1000,1000,a.profile_id
 FROM inf_state s CROSS JOIN inf_actor a WHERE s.tag='supplier' AND a.kind='owner';
 INSERT INTO inf_state(tag,id) VALUES(p_tag,v_id);
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION pg_temp.invoice_po(text) FROM PUBLIC,anon,authenticated;
GRANT SELECT ON inf_actor TO authenticated;
GRANT SELECT,INSERT,UPDATE ON inf_state TO authenticated;
