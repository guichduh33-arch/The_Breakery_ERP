-- pgtap:exclusive
-- supabase/tests/b2b_payment_number.test.sql
-- Le numéro de règlement B2B ne se tronque pas au-delà de 9999
-- (migration 20261125000006, famille record_b2b_payment).
--
-- Avant la correction, `LPAD(nextval('b2b_payment_seq')::text, 4, '0')`
-- rendait `BP-AAAA-1000` pour 10000 comme pour 10001 : le second règlement
-- violait `b2b_payments_payment_number_key`.
--
-- Exclusif : `setval` n'est pas annulé par le ROLLBACK. Le fichier pose la
-- séquence partagée puis la remet à sa valeur d'origine ; seul dans son
-- morceau, il ne décale pas les numéros d'un autre fichier en cours.
-- La petite valeur passe en premier : si le fichier s'arrête avant la
-- restauration, la séquence reste haute (10001), jamais sous les numéros émis.
--
--   T1 : petite valeur → toujours complétée à 4 chiffres (`BP-AAAA-0042`)
--   T2 : séquence posée à 9999 → deux règlements, numéros distincts à 5 chiffres
--   T3 : les deux règlements sont enregistrés, chacun avec son numéro
--   T4 : la séquence est remise à sa valeur d'origine
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

-- ---------------------------------------------------------------------------
-- Fixtures : un client B2B, un produit, une facture qui absorbe les règlements
-- ---------------------------------------------------------------------------
INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance) VALUES
  ('b2b90001-0000-0000-0000-000000000001', 'PGTAP B2B Payment Number', 'b2b', 'PT Payment Number', NULL, 0)
ON CONFLICT (id) DO NOTHING;
UPDATE customers SET b2b_credit_limit = NULL, b2b_current_balance = 0
 WHERE id = 'b2b90001-0000-0000-0000-000000000001';

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES (
  'b2b90002-0000-0000-0000-000000000001'::uuid,
  'PGTAP-B2BN-PROD', 'pgTAP B2B Payment Number Product',
  (SELECT id FROM categories LIMIT 1),
  50000, 100.000, 0
) ON CONFLICT (id) DO NOTHING;
UPDATE products SET current_stock = 100.000, track_inventory = true, deduct_stock = false
 WHERE id = 'b2b90002-0000-0000-0000-000000000001';

DO $bootstrap$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, true);
  PERFORM create_b2b_order_v11(
    p_customer_id => 'b2b90001-0000-0000-0000-000000000001',
    p_items       => jsonb_build_array(jsonb_build_object(
      'product_id', 'b2b90002-0000-0000-0000-000000000001',
      'quantity',   2,
      'unit_price', 50000
    ))
  );
END $bootstrap$;

-- Valeur d'origine de la séquence, remise en T4.
CREATE TEMP TABLE seq_origin AS
  SELECT last_value, is_called FROM b2b_payment_seq;

-- ===========================================================================
-- T1 — petite valeur : toujours 4 chiffres au minimum
-- ===========================================================================
SELECT setval('b2b_payment_seq', 41, true);
SELECT matches(
  (SELECT record_b2b_payment_v7(
            p_customer_id => 'b2b90001-0000-0000-0000-000000000001',
            p_amount      => 10000,
            p_method      => 'transfer'::payment_method)->>'payment_number'),
  '^BP-[0-9]{4}-[0-9]{4}$',
  'T1: small sequence value is still zero-padded to 4 digits (BP-YYYY-0042)');

-- ===========================================================================
-- T2/T3 — séquence au-delà de 9999 : deux règlements, deux numéros entiers
-- ===========================================================================
CREATE TEMP TABLE big_numbers (payment_id uuid, payment_number text);
SELECT setval('b2b_payment_seq', 9999, true);
INSERT INTO big_numbers
  SELECT (r->>'payment_id')::uuid, r->>'payment_number'
    FROM (SELECT record_b2b_payment_v7(
            p_customer_id => 'b2b90001-0000-0000-0000-000000000001',
            p_amount      => 10000,
            p_method      => 'transfer'::payment_method) AS r) s;
INSERT INTO big_numbers
  SELECT (r->>'payment_id')::uuid, r->>'payment_number'
    FROM (SELECT record_b2b_payment_v7(
            p_customer_id => 'b2b90001-0000-0000-0000-000000000001',
            p_amount      => 10000,
            p_method      => 'transfer'::payment_method) AS r) s;

SELECT ok(
  (SELECT count(DISTINCT payment_number) = 2
          AND bool_and(payment_number ~ '^BP-[0-9]{4}-[0-9]{5,}$')
          AND bool_and(split_part(payment_number, '-', 3)::bigint >= 10000)
     FROM big_numbers),
  'T2: sequence past 9999 — two payments get distinct, untruncated numbers (BP-YYYY-1000x)');

SELECT is(
  (SELECT count(*)::int FROM b2b_payments p JOIN big_numbers b
      ON b.payment_id = p.id AND b.payment_number = p.payment_number),
  2,
  'T3: both payments are stored, each with its returned number');

-- ===========================================================================
-- T4 — séquence remise à sa valeur d'origine
-- ===========================================================================
SELECT setval('b2b_payment_seq', o.last_value, o.is_called) FROM seq_origin o;
SELECT ok(
  (SELECT s.last_value = o.last_value AND s.is_called = o.is_called
     FROM b2b_payment_seq s, seq_origin o),
  'T4: b2b_payment_seq restored to its original value');

SELECT * FROM finish();
ROLLBACK;
