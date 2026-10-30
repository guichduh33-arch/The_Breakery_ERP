-- Transaction indépendante extraite de b2b_invoice.test.sql.
BEGIN;
\ir helpers/legacy_users.sql
SELECT plan(4);
DELETE FROM invoice_sequences WHERE year IN (2001, 2002);
INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_at)
VALUES
 ('BF-2002A','b2b','b2b_pending',10000,0,10000,'2002-01-15 10:00+00'),
 ('BF-2002B','b2b','b2b_pending',20000,0,20000,'2002-06-20 10:00+00'),
 ('BF-2001A','b2b','b2b_pending',30000,0,30000,'2001-12-10 10:00+00');
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
SELECT is((SELECT invoice_number FROM orders WHERE order_number='BF-2001A'), 'INV/2001/00001',
  'commande 2001 = INV/2001/00001 (seeding par année)');
SELECT is((SELECT invoice_number FROM orders WHERE order_number='BF-2002A'), 'INV/2002/00001',
  'commande 2002 la plus ancienne = INV/2002/00001');
SELECT is((SELECT invoice_number FROM orders WHERE order_number='BF-2002B'), 'INV/2002/00002',
  'commande 2002 suivante = INV/2002/00002 (ordre created_at)');
SELECT * FROM finish();
ROLLBACK;
