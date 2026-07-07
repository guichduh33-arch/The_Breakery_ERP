-- supabase/tests/b2b_invoice.test.sql
-- S68 — Facture PDF B2B : numérotation dédiée annuelle continue + get_b2b_invoice_v1.
-- Exécuter via MCP execute_sql (envelope BEGIN … ROLLBACK). Docker retraité.
--
-- Bloc 1 (Task 1) : schéma numérotation + helper _next_b2b_invoice_number_v1.

BEGIN;
SELECT plan(6);

-- Helper existe
SELECT has_function('public', '_next_b2b_invoice_number_v1', ARRAY[]::text[],
  '_next_b2b_invoice_number_v1() existe');

-- Format + continuité (séquence de l'année courante vierge dans la transaction de test)
DELETE FROM public.invoice_sequences WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int;
SELECT matches(
  public._next_b2b_invoice_number_v1(),
  '^INV/[0-9]{4}/00001$',
  'premier numéro = INV/YYYY/00001'
);
SELECT matches(
  public._next_b2b_invoice_number_v1(),
  '^INV/[0-9]{4}/00002$',
  'deuxième numéro = INV/YYYY/00002 (continuité)'
);

-- Colonnes + index + table
SELECT has_column('public', 'orders', 'invoice_number', 'orders.invoice_number existe');
SELECT has_column('public', 'invoice_sequences', 'last_number', 'invoice_sequences.last_number existe');
SELECT has_index('public', 'orders', 'orders_invoice_number_key',
  'index unique partiel sur orders.invoice_number');

SELECT * FROM finish();
ROLLBACK;

-- Bloc 2 (Task 2) : create_b2b_order_v4 attribue l'invoice_number à la création.
BEGIN;
SELECT plan(6);

SELECT has_function('public', 'create_b2b_order_v4',
  ARRAY['uuid','jsonb','text','date','uuid'], 'create_b2b_order_v4 existe');
SELECT hasnt_function('public', 'create_b2b_order_v3',
  ARRAY['uuid','jsonb','text','date','uuid'], 'create_b2b_order_v3 droppée');

SELECT set_config('request.jwt.claim.sub', (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);

INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
VALUES ('ccc68001-0000-0000-0000-000000000001','S68 B2B Unlimited','b2b','PT S68', NULL, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold, track_inventory, deduct_stock, unit, is_display_item)
VALUES ('ddd68001-0000-0000-0000-000000000001','S68-NOTRACK','S68 NoTrack',(SELECT id FROM categories LIMIT 1),10000,0,0,false,false,'pcs',false)
ON CONFLICT (id) DO NOTHING;
UPDATE products SET track_inventory=false, deduct_stock=false, is_display_item=false WHERE id='ddd68001-0000-0000-0000-000000000001';

CREATE TEMP TABLE _r(name text PRIMARY KEY, val text) ON COMMIT DROP;
DO $d$
DECLARE v1 jsonb; v2 jsonb;
BEGIN
  v1 := create_b2b_order_v4('ccc68001-0000-0000-0000-000000000001',
        jsonb_build_array(jsonb_build_object('product_id','ddd68001-0000-0000-0000-000000000001','quantity',2,'unit_price',10000)),
        NULL, NULL, gen_random_uuid());
  v2 := create_b2b_order_v4('ccc68001-0000-0000-0000-000000000001',
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
