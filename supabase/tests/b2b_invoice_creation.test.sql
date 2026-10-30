-- Transaction indépendante extraite de b2b_invoice.test.sql.
BEGIN;
\ir helpers/customer_category.sql
\ir helpers/legacy_users.sql
SELECT plan(6);

SELECT has_function('public', 'create_b2b_order_v8',
  ARRAY['uuid','jsonb','text','date','uuid'], 'create_b2b_order existe');
SELECT hasnt_function('public', 'create_b2b_order_v3',
  ARRAY['uuid','jsonb','text','date','uuid'], 'create_b2b_order_v3 droppée');

SELECT set_config('request.jwt.claim.sub', (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);

INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance, category_id)
VALUES ('ccc68001-0000-0000-0000-000000000001','S68 B2B Unlimited','b2b','PT S68', NULL, 0, current_setting('fixture.customer_category')::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold, track_inventory, deduct_stock, unit, is_display_item)
VALUES ('ddd68001-0000-0000-0000-000000000001','S68-NOTRACK','S68 NoTrack',(SELECT id FROM categories LIMIT 1),10000,0,0,false,false,'pcs',false)
ON CONFLICT (id) DO NOTHING;
UPDATE products SET track_inventory=false, deduct_stock=false, is_display_item=false WHERE id='ddd68001-0000-0000-0000-000000000001';

CREATE TEMP TABLE _r(name text PRIMARY KEY, val text) ON COMMIT DROP;
DO $d$
DECLARE v1 jsonb; v2 jsonb;
BEGIN
  v1 := create_b2b_order_v8('ccc68001-0000-0000-0000-000000000001',
        jsonb_build_array(jsonb_build_object('product_id','ddd68001-0000-0000-0000-000000000001','quantity',2,'unit_price',10000)),
        NULL, NULL, gen_random_uuid());
  v2 := create_b2b_order_v8('ccc68001-0000-0000-0000-000000000001',
        jsonb_build_array(jsonb_build_object('product_id','ddd68001-0000-0000-0000-000000000001','quantity',1,'unit_price',10000)),
        NULL, NULL, gen_random_uuid());
  INSERT INTO _r VALUES ('inv1', v1->>'invoice_number');
  INSERT INTO _r VALUES ('inv2', v2->>'invoice_number');
  INSERT INTO _r VALUES ('persisted', (SELECT invoice_number FROM orders WHERE id=(v1->>'order_id')::uuid));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('inv1', 'ERR:'||SQLERRM);
  INSERT INTO _r VALUES ('inv2', NULL);
  INSERT INTO _r VALUES ('persisted', NULL);
END $d$;

SELECT matches((SELECT val FROM _r WHERE name='inv1'), '^INV/[0-9]{4}/[0-9]{5}$', 'envelope 1 porte un invoice_number');
SELECT is(
  (SELECT (regexp_replace((SELECT val FROM _r WHERE name='inv2'), '.*/', ''))::int),
  (SELECT (regexp_replace((SELECT val FROM _r WHERE name='inv1'), '.*/', ''))::int) + 1,
  'continuité : inv2 = inv1 + 1'
);
SELECT is((SELECT val FROM _r WHERE name='persisted'), (SELECT val FROM _r WHERE name='inv1'), 'orders.invoice_number persistée = envelope');
SELECT ok((SELECT val FROM _r WHERE name='inv1') NOT LIKE 'ERR:%', 'aucune exception lors de la création');

SELECT * FROM finish();
ROLLBACK;
