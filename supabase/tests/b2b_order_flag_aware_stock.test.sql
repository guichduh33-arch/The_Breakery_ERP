-- S50 Vague 2a-i · T4 — create_b2b_order stock flag-aware (fix N1) + JE reference_type B2B
--
-- A : produit non-tracké (track_inventory=false, deduct_stock=false, stock 0) → commande B2B
--     réussit AVEC un JE (avant : insufficient_stock inconditionnel + reference_type rejeté).
-- B : produit tracké + allow_negative=false + stock 0 → lève insufficient_stock (guard préservé).
-- C : produit tracké + allow_negative=true + stock 0 → réussit (le flag allow_negative est
--     enfin respecté, comme au POS v14 ; avant : bloqué inconditionnellement).
--
-- Run via MCP execute_sql sous BEGIN/ROLLBACK. Auth simulée via request.jwt.claim.sub (EMP000).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);

SELECT set_config('request.jwt.claim.sub', (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);

INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
VALUES ('ccc40001-0000-0000-0000-000000000001','T4 B2B Unlimited','b2b','PT T4', NULL, 0)
ON CONFLICT (id) DO NOTHING;
UPDATE customers SET b2b_credit_limit = NULL, b2b_current_balance = 0
 WHERE id = 'ccc40001-0000-0000-0000-000000000001';

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold, track_inventory, deduct_stock, unit)
VALUES
 ('ddd40001-0000-0000-0000-000000000001','T4-UNTRACKED','T4 Untracked',(SELECT id FROM categories LIMIT 1),10000,0,0,false,false,'pcs'),
 ('ddd40002-0000-0000-0000-000000000002','T4-TRACKED','T4 Tracked',(SELECT id FROM categories LIMIT 1),10000,0,0,true,false,'pcs')
ON CONFLICT (id) DO NOTHING;
UPDATE products SET current_stock = 0, track_inventory=false, deduct_stock=false WHERE id='ddd40001-0000-0000-0000-000000000001';
UPDATE products SET current_stock = 0, track_inventory=true,  deduct_stock=false WHERE id='ddd40002-0000-0000-0000-000000000002';

CREATE TEMP TABLE _r(name text PRIMARY KEY, pass boolean) ON COMMIT DROP;

-- A : non-tracké stock 0 → vendable + JE
DO $a$ DECLARE v jsonb; BEGIN
  v := create_b2b_order_v1('ccc40001-0000-0000-0000-000000000001',
        jsonb_build_array(jsonb_build_object('product_id','ddd40001-0000-0000-0000-000000000001','quantity',2,'unit_price',10000)),
        NULL, NULL, gen_random_uuid());
  INSERT INTO _r VALUES ('A', (v->>'order_id') IS NOT NULL AND (v->>'je_id') IS NOT NULL);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('A', false); END $a$;

-- B : tracké + allow_negative=false + stock 0 → insufficient_stock
UPDATE business_config SET allow_negative_stock=false;
DO $b$ BEGIN
  PERFORM create_b2b_order_v1('ccc40001-0000-0000-0000-000000000001',
        jsonb_build_array(jsonb_build_object('product_id','ddd40002-0000-0000-0000-000000000002','quantity',1,'unit_price',10000)),
        NULL, NULL, gen_random_uuid());
  INSERT INTO _r VALUES ('B', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('B', SQLERRM LIKE '%insufficient_stock%'); END $b$;

-- C : tracké + allow_negative=true + stock 0 → vendable
UPDATE business_config SET allow_negative_stock=true;
DO $c$ DECLARE v jsonb; BEGIN
  v := create_b2b_order_v1('ccc40001-0000-0000-0000-000000000001',
        jsonb_build_array(jsonb_build_object('product_id','ddd40002-0000-0000-0000-000000000002','quantity',1,'unit_price',10000)),
        NULL, NULL, gen_random_uuid());
  INSERT INTO _r VALUES ('C', (v->>'order_id') IS NOT NULL);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('C', false); END $c$;

SELECT ok((SELECT pass FROM _r WHERE name='A'), 'T4-A: produit non-tracké vendable en B2B (fix N1) avec JE valide');
SELECT ok((SELECT pass FROM _r WHERE name='B'), 'T4-B: tracké + allow_negative=false + stock 0 lève insufficient_stock');
SELECT ok((SELECT pass FROM _r WHERE name='C'), 'T4-C: tracké + allow_negative=true vendable (flag respecté)');

SELECT * FROM finish();
ROLLBACK;
