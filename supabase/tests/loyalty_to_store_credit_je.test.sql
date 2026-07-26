-- supabase/tests/loyalty_to_store_credit_je.test.sql
-- ADR-013 Lot 4 (D6) — convert_loyalty_to_store_credit_v1 :
--   conversion points -> avoir (x10), ledger loyalty_conversion, JE de transfert
--   de dette DR 2210 / CR 2220, gardes (P0010 points insuffisants, multiple de
--   100), replay idempotent.
-- Run via MCP execute_sql (BEGIN..ROLLBACK) ou API-from-file.

BEGIN;
SELECT plan(6);

DO $$
DECLARE v_auth UUID; v_prof UUID; v_cust UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'customers.store_credit.convert')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no user with customers.store_credit.convert'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  INSERT INTO customers (name, customer_type, loyalty_points, lifetime_points)
    VALUES ('SC Convert Customer', 'retail', 2000, 2000) RETURNING id INTO v_cust;
  PERFORM set_config('scc.cust', v_cust::text, true);
  PERFORM set_config('scc.idem', gen_random_uuid()::text, true);
END $$;

-- T1 — happy path : 1000 pts -> 10 000 d'avoir, points débités, ledger + LT.
DO $$
DECLARE v_res JSONB; v_pts INT; v_bal NUMERIC; v_n INT; v_lt INT;
BEGIN
  v_res := convert_loyalty_to_store_credit_v1(
    current_setting('scc.cust')::uuid, 1000, current_setting('scc.idem')::uuid);
  SELECT loyalty_points, store_credit_balance INTO v_pts, v_bal
    FROM customers WHERE id = current_setting('scc.cust')::uuid;
  SELECT count(*) INTO v_n FROM customer_store_credit_ledger
   WHERE customer_id = current_setting('scc.cust')::uuid
     AND source = 'loyalty_conversion' AND delta = 10000 AND balance_after = 10000;
  SELECT count(*) INTO v_lt FROM loyalty_transactions
   WHERE customer_id = current_setting('scc.cust')::uuid
     AND transaction_type = 'redeem' AND points = -1000
     AND description = 'Converted to store credit';
  PERFORM set_config('scc.ledger1', (v_res->>'ledger_id'), true);
  PERFORM set_config('scc.t1', (v_pts=1000 AND v_bal=10000 AND v_n=1 AND v_lt=1)::text, true);
END $$;
SELECT ok(current_setting('scc.t1')::boolean,
  'T1: 1000 pts -> 10000 store credit, points debited, ledger + loyalty_transactions rows');

-- T2 — JE de transfert de dette : DR 2210 / CR 2220, équilibré.
DO $$
DECLARE v_je UUID; v_dr NUMERIC; v_cr NUMERIC;
BEGIN
  SELECT id INTO v_je FROM journal_entries
   WHERE reference_type = 'store_credit_conversion'
     AND reference_id = current_setting('scc.ledger1')::uuid;
  SELECT COALESCE(SUM(debit) FILTER (WHERE account_id = resolve_mapping_account('LOYALTY_LIABILITY')), 0),
         COALESCE(SUM(credit) FILTER (WHERE account_id = resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT')), 0)
    INTO v_dr, v_cr
    FROM journal_entry_lines WHERE journal_entry_id = v_je;
  PERFORM set_config('scc.t2', (v_je IS NOT NULL AND v_dr = 10000 AND v_cr = 10000)::text, true);
END $$;
SELECT ok(current_setting('scc.t2')::boolean,
  'T2: conversion JE is DR 2210 Loyalty Liability / CR 2220 Store Credit, 10000/10000');

-- T3 — replay idempotent : même clé → enveloppe, pas de second débit de points.
DO $$
DECLARE v_res JSONB; v_pts INT; v_n INT;
BEGIN
  v_res := convert_loyalty_to_store_credit_v1(
    current_setting('scc.cust')::uuid, 1000, current_setting('scc.idem')::uuid);
  SELECT loyalty_points INTO v_pts FROM customers WHERE id = current_setting('scc.cust')::uuid;
  SELECT count(*) INTO v_n FROM customer_store_credit_ledger
   WHERE customer_id = current_setting('scc.cust')::uuid AND source = 'loyalty_conversion';
  PERFORM set_config('scc.t3',
    ((v_res->>'idempotent_replay')::boolean AND v_pts = 1000 AND v_n = 1)::text, true);
END $$;
SELECT ok(current_setting('scc.t3')::boolean,
  'T3: idempotent replay returns envelope, no double conversion');

-- T4 — points insuffisants (5000 > 1000) → P0010.
SELECT throws_ok($q$
  SELECT convert_loyalty_to_store_credit_v1(current_setting('scc.cust')::uuid, 5000)
$q$, 'P0010', NULL,
  'T4: converting more points than the balance rejected (P0010)');

-- T5 — non-multiple de 100 → check_violation.
SELECT throws_ok($q$
  SELECT convert_loyalty_to_store_credit_v1(current_setting('scc.cust')::uuid, 150)
$q$, '23514', 'Points to convert must be a positive multiple of 100',
  'T5: non-multiple-of-100 points rejected');

-- T6 — cohérence cache/ledger après le scénario.
SELECT is(
  (SELECT store_credit_balance FROM customers WHERE id = current_setting('scc.cust')::uuid),
  (SELECT COALESCE(SUM(delta), 0) FROM customer_store_credit_ledger
    WHERE customer_id = current_setting('scc.cust')::uuid),
  'T6: customers.store_credit_balance == SUM(ledger.delta)');

SELECT * FROM finish();
ROLLBACK;
