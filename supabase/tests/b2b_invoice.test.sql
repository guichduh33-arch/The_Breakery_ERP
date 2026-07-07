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

-- Bloc 3 (Task 3) : backfill idempotent des commandes B2B existantes (ordre + seeding par année).
BEGIN;
SELECT plan(4);
DELETE FROM invoice_sequences WHERE year IN (2025, 2026);
INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_at)
VALUES
 ('BF-2026A','b2b','b2b_pending',10000,0,10000,'2026-01-15 10:00+00'),
 ('BF-2026B','b2b','b2b_pending',20000,0,20000,'2026-06-20 10:00+00'),
 ('BF-2025A','b2b','b2b_pending',30000,0,30000,'2025-12-10 10:00+00');
-- Backfill DML (copie exacte de la migration _131)
DO $$
DECLARE r RECORD; v_n INTEGER;
BEGIN
  FOR r IN SELECT id, EXTRACT(YEAR FROM created_at)::int AS yr
             FROM orders WHERE order_type='b2b' AND invoice_number IS NULL
            ORDER BY created_at, id LOOP
    INSERT INTO invoice_sequences (year, last_number) VALUES (r.yr, 1)
      ON CONFLICT (year) DO UPDATE SET last_number = invoice_sequences.last_number + 1
      RETURNING last_number INTO v_n;
    UPDATE orders SET invoice_number = 'INV/'||r.yr::text||'/'||LPAD(v_n::text,5,'0') WHERE id = r.id;
  END LOOP;
END $$;
SELECT is((SELECT count(*) FROM orders WHERE order_type='b2b' AND invoice_number IS NULL)::int, 0,
  'aucune commande B2B ne reste sans invoice_number');
SELECT is((SELECT invoice_number FROM orders WHERE order_number='BF-2025A'), 'INV/2025/00001',
  'commande 2025 = INV/2025/00001 (seeding par année)');
SELECT is((SELECT invoice_number FROM orders WHERE order_number='BF-2026A'), 'INV/2026/00001',
  'commande 2026 la plus ancienne = INV/2026/00001');
SELECT is((SELECT invoice_number FROM orders WHERE order_number='BF-2026B'), 'INV/2026/00002',
  'commande 2026 suivante = INV/2026/00002 (ordre created_at)');
SELECT * FROM finish();
ROLLBACK;
