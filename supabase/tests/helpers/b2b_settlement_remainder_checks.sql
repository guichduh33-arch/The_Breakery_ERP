-- T15 — reliquat refusé (audit lot 1 P0 n°4, finding 1) : record_b2b_payment_v3
--   RAISE P0011 payment_not_fully_allocated si v_remaining > 0 après les deux
--   boucles ; JE + b2b_payments + allocations + décrément de balance annulés
--   EN BLOC. Voir le commentaire d'en-tête pour la reproduction et le choix de
--   plier "raise + 3 preuves de rollback" dans un seul ok() (budget plan(17)).
-- ===========================================================================
DO $t15$
DECLARE
  v_cust UUID := 'b2b52001-0000-0000-0000-000000000015';
  v_pay_count_before INT; v_pay_count_after INT;
  v_je_count_before  INT; v_je_count_after  INT;
  v_balance_after NUMERIC;
  v_caught_p0011  BOOLEAN := FALSE;
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);

  INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
  VALUES (v_cust, 'PGTAP S52 C15 Remainder', 'b2b', 'PT C15', NULL, 0)
  ON CONFLICT (id) DO UPDATE SET b2b_credit_limit = NULL, b2b_current_balance = 0;

  PERFORM pg_temp.mk_invoice(v_cust, 2, 50000, '2026-06-12'::timestamptz);

  -- Cache inflation : le chemin d'atteignabilité nommé par l'audit (le guard
  -- anti-overpayment lit customers.b2b_current_balance, pas Σ outstanding).
  UPDATE customers SET b2b_current_balance = 150000 WHERE id = v_cust;

  SELECT COUNT(*) INTO v_pay_count_before FROM b2b_payments WHERE customer_id = v_cust;
  SELECT COUNT(*) INTO v_je_count_before FROM journal_entries
    WHERE reference_type = 'b2b_payment'
      AND description = 'B2B payment received from customer ' || v_cust::text;

  BEGIN
    PERFORM record_b2b_payment_v4(
      p_customer_id => v_cust, p_amount => 150000, p_method => 'cash'::payment_method);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0011' THEN
      v_caught_p0011 := TRUE;
    ELSE
      RAISE WARNING 'T15 unexpected error % : %', SQLSTATE, SQLERRM;
    END IF;
  END;

  SELECT COUNT(*) INTO v_pay_count_after FROM b2b_payments WHERE customer_id = v_cust;
  SELECT COUNT(*) INTO v_je_count_after FROM journal_entries
    WHERE reference_type = 'b2b_payment'
      AND description = 'B2B payment received from customer ' || v_cust::text;
  SELECT b2b_current_balance INTO v_balance_after FROM customers WHERE id = v_cust;

  PERFORM set_config('breakery.t15', CASE WHEN
    v_caught_p0011
    AND v_pay_count_before = 0 AND v_pay_count_after = 0
    AND v_je_count_before  = 0 AND v_je_count_after  = 0
    AND v_balance_after = 150000
  THEN 'true' ELSE 'false' END, false);
END $t15$;
SELECT ok(current_setting('breakery.t15')::boolean,
  'T15: remainder refused — record_b2b_payment_v4 raises P0011 payment_not_fully_allocated; JE/payment/balance cache all rolled back (audit lot1 P0#4)');

-- ===========================================================================
-- T16 — contrat de payload : allocated_total / unallocated (nouvelles clés v3)
-- ===========================================================================
DO $t16$
DECLARE
  v_cust UUID := 'b2b52001-0000-0000-0000-000000000016';
  v_res JSONB;
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);

  INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
  VALUES (v_cust, 'PGTAP S52 C16 Payload', 'b2b', 'PT C16', NULL, 0)
  ON CONFLICT (id) DO UPDATE SET b2b_credit_limit = NULL, b2b_current_balance = 0;

  PERFORM pg_temp.mk_invoice(v_cust, 2, 50000, '2026-06-13'::timestamptz);
  UPDATE customers SET b2b_current_balance = 100000 WHERE id = v_cust;

  v_res := record_b2b_payment_v4(
    p_customer_id => v_cust, p_amount => 100000, p_method => 'cash'::payment_method);

  PERFORM set_config('breakery.t16', CASE WHEN
    (v_res->>'allocated_total')::numeric = 100000
    AND (v_res->>'unallocated')::numeric = 0
  THEN 'true' ELSE 'false' END, false);
END $t16$;
SELECT ok(current_setting('breakery.t16')::boolean,
  'T16: payload contract — record_b2b_payment_v4 returns allocated_total=100000, unallocated=0 on a clean full settlement');

-- ===========================================================================
-- T17 — FIFO sert toujours une facture b2b_pending PARTIELLEMENT réglée
--   (non-régression du prédicat FIFO élargi à status <> 'voided')
-- ===========================================================================
DO $t17$
DECLARE
  v_cust UUID := 'b2b52001-0000-0000-0000-000000000017';
  v_inv UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);

  INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
  VALUES (v_cust, 'PGTAP S52 C17 FIFO', 'b2b', 'PT C17', NULL, 0)
  ON CONFLICT (id) DO UPDATE SET b2b_credit_limit = NULL, b2b_current_balance = 0;

  v_inv := pg_temp.mk_invoice(v_cust, 2, 50000, '2026-06-14'::timestamptz);
  UPDATE customers SET b2b_current_balance = 100000 WHERE id = v_cust;

  PERFORM record_b2b_payment_v4(
    p_customer_id => v_cust, p_amount => 40000, p_method => 'cash'::payment_method);
  PERFORM record_b2b_payment_v4(
    p_customer_id => v_cust, p_amount => 60000, p_method => 'cash'::payment_method);

  PERFORM set_config('breakery.t17', CASE WHEN
    (SELECT status FROM orders WHERE id = v_inv) = 'paid'
    AND (SELECT outstanding FROM view_b2b_invoices WHERE invoice_id = v_inv) = 0
    AND (SELECT SUM(amount_applied) FROM b2b_payment_allocations WHERE invoice_id = v_inv) = 100000
  THEN 'true' ELSE 'false' END, false);
END $t17$;
SELECT ok(current_setting('breakery.t17')::boolean,
  'T17: FIFO still serves a partially-settled b2b_pending invoice — 2nd payment (60K, no p_invoice_ids) completes it (status=paid, outstanding=0)');
