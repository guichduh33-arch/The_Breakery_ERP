-- supabase/tests/b2b_allocation_invariant.test.sql
-- Lot chore/b2b-allocation-invariant (décision Mamat 2026-09-06) — la base impose
-- Σ b2b_payment_allocations.amount_applied = b2b_payments.amount.
--
-- Audit b2b-credit du 2026-08-31 (docs/audits/2026-08-31-audit-b2b-credit.md,
-- finding 1) : « aucun CHECK, aucun trigger, aucun test n'impose l'invariant ».
-- record_b2b_payment_v3 refuse déjà le reliquat en amont (P0011), mais un corps
-- SECURITY DEFINER passe au travers de la RLS et des REVOKE : seul un trigger de
-- contrainte DIFFÉRÉ ferme le trou sans casser l'ordre d'INSERT de la RPC
-- (paiement d'abord, allocations ensuite, équilibre atteint au COMMIT).
--
--   T1 : les deux triggers existent et sont des CONSTRAINT TRIGGER deferrable,
--        initially deferred (b2b_payments + b2b_payment_allocations)
--   T2 : le chemin RPC passe le trigger — après le flush, Σ allocations du
--        paiement v3 = amount = 100000
--   T3 : INSERT direct d'un paiement orphelin (0 allocation) → P0011
--   T4 : INSERT d'une allocation supplémentaire sur un paiement équilibré
--        (sur-allocation, facture 2) → P0011
--   T5 : DELETE d'une allocation d'un paiement équilibré → P0011 (en tant que
--        postgres : ce que la RLS n'arrête pas)
--   T6 : UPDATE b2b_payments.amount → P0011
--   T7 : fn_check_b2b_payment_allocated() révoquée pour anon ET authenticated
--   T8 : invariant vérifié sur les données live — 0 paiement dont Σ ≠ amount
--        (la réconciliation du 2026-09-06 devient une assertion nightly)
--   T9 : UPDATE amount_applied d'une allocation → P0011
--   T10: une allocation qui change de paiement puis disparaît (mode différé
--        rétabli le temps du scénario) laisse l'ancien paiement sous-alloué :
--        le flush doit le relire et refuser — review du 2026-09-06, le côté
--        OLD d'un UPDATE de payment_id n'était pas revérifié
--
-- Harnais trigger différé (pattern reversal_je / store_credit_reconciliation) :
-- toutes les opérations RPC sont jouées AVANT l'unique SET CONSTRAINTS ALL
-- IMMEDIATE ; ensuite chaque DML de T3–T6 et T9 tire le trigger en fin
-- d'instruction, à l'intérieur du throws_ok. T10 repasse en DEFERRED à
-- l'intérieur de son bloc et flushe lui-même.
--
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope). pgtap pre-installed on V3 dev.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures : 1 b2b customer (unlimited) + 1 tracked product (clone b2b_settlement)
-- ---------------------------------------------------------------------------
INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
VALUES ('b2b53001-0000-0000-0000-000000000001','PGTAP INV C1','b2b','PT INV C1',NULL,0)
ON CONFLICT (id) DO UPDATE SET b2b_credit_limit = NULL, b2b_current_balance = 0;

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES ('b2b53002-0000-0000-0000-000000000001','PGTAP-INV-PROD','pgTAP INV Product',
        (SELECT id FROM categories LIMIT 1), 50000, 1000.000, 0)
ON CONFLICT (id) DO NOTHING;
UPDATE products SET current_stock=1000.000, track_inventory=true, deduct_stock=false
 WHERE id='b2b53002-0000-0000-0000-000000000001';

DO $bootstrap$
DECLARE v_admin UUID; v_profile UUID;
BEGIN
  SELECT auth_user_id, id INTO v_admin, v_profile FROM user_profiles WHERE employee_code='EMP000';
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Seed user EMP000 missing'; END IF;
  PERFORM set_config('breakery.admin_uid', v_admin::text, false);
  PERFORM set_config('breakery.admin_profile', v_profile::text, false);
END $bootstrap$;

CREATE OR REPLACE FUNCTION pg_temp.set_jwt_uid(p_uid UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', p_uid::text, true); END $$;

CREATE OR REPLACE FUNCTION pg_temp.mk_invoice(p_cust UUID, p_qty NUMERIC, p_price NUMERIC, p_created TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_res JSONB; v_id UUID;
BEGIN
  v_res := create_b2b_order_v7(
    p_customer_id => p_cust,
    p_items => jsonb_build_array(jsonb_build_object(
      'product_id','b2b53002-0000-0000-0000-000000000001','quantity',p_qty,'unit_price',p_price)));
  v_id := (v_res->>'order_id')::uuid;
  UPDATE orders SET created_at = p_created WHERE id = v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- Scénario RPC (AVANT le flush) : facture 1 (100K) + facture 2 (50K), cache
-- 150K, paiement A v3 de 100K ciblé sur la facture 1, paiement B v3 de 50K
-- ciblé sur la facture 2 → tous deux équilibrés par construction. T4 sur-alloue
-- A sur la facture 2 (clé unique (paiement, facture) respectée : B, pas A, y est
-- alloué) ; T10 déplace l'allocation de A vers B.
-- ---------------------------------------------------------------------------
DO $setup$
DECLARE
  v_cust UUID := 'b2b53001-0000-0000-0000-000000000001';
  v_inv1 UUID; v_inv2 UUID; v_res JSONB;
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);
  v_inv1 := pg_temp.mk_invoice(v_cust, 2, 50000, '2026-06-01'::timestamptz);
  v_inv2 := pg_temp.mk_invoice(v_cust, 1, 50000, '2026-06-10'::timestamptz);
  UPDATE customers SET b2b_current_balance = 150000 WHERE id = v_cust;
  v_res := record_b2b_payment_v3(
    p_customer_id => v_cust, p_amount => 100000, p_method => 'cash'::payment_method,
    p_invoice_ids => ARRAY[v_inv1]);
  PERFORM set_config('breakery.pay',  v_res->>'payment_id', false);
  v_res := record_b2b_payment_v3(
    p_customer_id => v_cust, p_amount => 50000, p_method => 'cash'::payment_method,
    p_invoice_ids => ARRAY[v_inv2]);
  PERFORM set_config('breakery.pay_b', v_res->>'payment_id', false);
  PERFORM set_config('breakery.inv1', v_inv1::text, false);
  PERFORM set_config('breakery.inv2', v_inv2::text, false);
END $setup$;

-- Flush unique : les triggers différés tirent ici (T2), puis chaque DML tire
-- en fin d'instruction (T3–T6).
SET CONSTRAINTS ALL IMMEDIATE;

-- T1 — les deux triggers de contrainte, deferrable + initially deferred
SELECT ok(
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname IN ('b2b_payments','b2b_payment_allocations')
      AND t.tgname IN ('trg_b2b_payments_allocation_invariant','trg_b2b_payment_allocations_invariant')
      AND t.tgconstraint <> 0 AND t.tgdeferrable AND t.tginitdeferred) = 2,
  'T1: both invariant triggers exist as CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED');

-- T2 — le chemin RPC passe le trigger : équilibre exact après le flush
SELECT ok(
  (SELECT amount FROM b2b_payments WHERE id = current_setting('breakery.pay')::uuid) = 100000
  AND (SELECT SUM(amount_applied) FROM b2b_payment_allocations
        WHERE payment_id = current_setting('breakery.pay')::uuid) = 100000,
  'T2: record_b2b_payment_v3 path survives the flush — Σ allocations = amount = 100000');

-- T3 — paiement orphelin refusé
SELECT throws_ok(
  format($sql$INSERT INTO b2b_payments (payment_number, customer_id, amount, method, paid_at, created_by, allocation)
    VALUES ('BP-PGTAP-ORPHAN', %L, 12345, 'cash', now(), %L, '[]'::jsonb)$sql$,
    'b2b53001-0000-0000-0000-000000000001', current_setting('breakery.admin_profile')),
  'P0011', NULL,
  'T3: a direct b2b_payments INSERT with no allocation is refused (P0011)');

-- T4 — sur-allocation refusée (facture 2, paiement déjà équilibré)
SELECT throws_ok(
  format($sql$INSERT INTO b2b_payment_allocations (payment_id, invoice_id, amount_applied)
    VALUES (%L, %L, 50000)$sql$, current_setting('breakery.pay'), current_setting('breakery.inv2')),
  'P0011', NULL,
  'T4: an extra allocation on a balanced payment (Σ 150000 > 100000) is refused (P0011)');

-- T5 — suppression d'une allocation refusée (postgres, hors RLS)
SELECT throws_ok(
  format($sql$DELETE FROM b2b_payment_allocations WHERE payment_id = %L$sql$, current_setting('breakery.pay')),
  'P0011', NULL,
  'T5: deleting the allocation of a balanced payment is refused (P0011) even for the table owner');

-- T6 — modification du montant refusée
SELECT throws_ok(
  format($sql$UPDATE b2b_payments SET amount = amount + 1 WHERE id = %L$sql$, current_setting('breakery.pay')),
  'P0011', NULL,
  'T6: changing b2b_payments.amount away from Σ allocations is refused (P0011)');

-- T7 — fonction de trigger fermée à anon et authenticated
SELECT ok(
  CASE WHEN to_regprocedure('public.fn_check_b2b_payment_allocated()') IS NULL THEN false
       ELSE NOT has_function_privilege('anon', 'public.fn_check_b2b_payment_allocated()', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.fn_check_b2b_payment_allocated()', 'EXECUTE')
  END,
  'T7: fn_check_b2b_payment_allocated() exists and is revoked from anon and authenticated');

-- T8 — invariant vérifié sur les données live (hors fixture : avant la
-- migration, les DML de T3–T6 vivent et pollueraient le compte)
SELECT is(
  (SELECT count(*) FROM b2b_payments p
    WHERE p.customer_id <> 'b2b53001-0000-0000-0000-000000000001'
      AND p.amount <> (SELECT COALESCE(SUM(a.amount_applied), 0)
                         FROM b2b_payment_allocations a WHERE a.payment_id = p.id)),
  0::bigint,
  'T8: no live b2b_payments row whose amount differs from Σ of its allocations');

-- T9 — modification du montant d'une allocation refusée
SELECT throws_ok(
  format($sql$UPDATE b2b_payment_allocations SET amount_applied = amount_applied + 1 WHERE payment_id = %L$sql$,
    current_setting('breakery.pay')),
  'P0011', NULL,
  'T9: changing an allocation amount away from the payment amount is refused (P0011)');

-- T10 — l'allocation de A migre vers B puis disparaît : au flush, B est
-- redevenu équilibré, A n'a plus rien → le côté OLD doit être relu et refusé
SELECT throws_ok(
  format($sql$DO $do$ BEGIN
      SET CONSTRAINTS ALL DEFERRED;
      UPDATE b2b_payment_allocations SET payment_id = %L WHERE payment_id = %L;
      DELETE FROM b2b_payment_allocations WHERE payment_id = %L AND invoice_id = %L;
      SET CONSTRAINTS ALL IMMEDIATE;
    END $do$$sql$,
    current_setting('breakery.pay_b'), current_setting('breakery.pay'),
    current_setting('breakery.pay_b'), current_setting('breakery.inv1')),
  'P0011', NULL,
  'T10: an allocation moved to another payment then deleted leaves the old payment under-allocated — refused at flush (P0011)');

SELECT * FROM finish();
ROLLBACK;
