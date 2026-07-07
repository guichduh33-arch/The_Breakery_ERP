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
