-- 20260601000020_create_record_b2b_payment_v1.sql
-- Session 24 / Phase 1.A.2 / migration 9
--
-- record_b2b_payment_v1 : enregistre un paiement reçu d'un customer B2B,
-- émet le JE (DR Cash ou Bank / CR B2B_AR), décrémente le cache
-- customers.b2b_current_balance, INSERT b2b_payments + audit_logs.
--
-- Pattern :
--   1. auth.uid() + user_profile + has_permission('customers.update')
--   2. idempotency check via b2b_payments.idempotency_key
--   3. validate (amount>0, customer existe, customer_type='b2b')
--   4. check_fiscal_period_open (D12 helper)
--   5. FOR UPDATE customer row + snapshot balance_before
--   6. overpayment check (balance - amount < 0 → RAISE P0011)
--   7. snapshot allocation FIFO via SELECT orders unpaid (metadata only — D3)
--   8. JE : resolve_mapping_account('SALE_PAYMENT_CASH') ou 'B2B_PAYMENT_BANK'
--      + resolve_mapping_account('B2B_AR') ; INSERT journal_entries +
--      2 journal_entry_lines (DR Cash/Bank / CR B2B_AR)
--   9. INSERT b2b_payments avec sequence BP-YYYY-NNNN
--   10. UPDATE customers.b2b_current_balance -= amount (cache miss-proof
--       car colonne REVOKE UPDATE pour authenticated, on opère ici en
--       SECURITY DEFINER postgres)
--   11. INSERT audit_logs (action='b2b.payment.recorded')
--   12. RETURN JSONB { payment_id, payment_number, allocation, je_id,
--       customer_balance_after }

CREATE OR REPLACE FUNCTION record_b2b_payment_v1(
  p_customer_id    UUID,
  p_amount         NUMERIC,
  p_method         payment_method,
  p_reference      TEXT          DEFAULT NULL,
  p_paid_at        TIMESTAMPTZ   DEFAULT now(),
  p_notes          TEXT          DEFAULT NULL,
  p_idempotency_key UUID         DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile_id       UUID;
  v_customer_type    customer_type;
  v_balance_before   NUMERIC(14,2);
  v_balance_after    NUMERIC(14,2);
  v_existing_id      UUID;
  v_existing_row     b2b_payments%ROWTYPE;
  v_payment_id       UUID;
  v_payment_number   TEXT;
  v_je_id            UUID;
  v_entry_no         TEXT;
  v_cash_or_bank_id  UUID;
  v_ar_id            UUID;
  v_allocation       JSONB := '[]'::jsonb;
  v_running_total    NUMERIC(14,2) := 0;
  v_inv              RECORD;
  v_amount_applied   NUMERIC(14,2);
BEGIN
  -- 1) Auth + profile lookup
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_uid, 'customers.update') THEN
    RAISE EXCEPTION 'permission_denied: customers.update' USING ERRCODE = 'P0003';
  END IF;

  -- 2) Idempotency : si key déjà vue → retourner le row existant
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_row
      FROM b2b_payments
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF FOUND THEN
      SELECT b2b_current_balance INTO v_balance_after
        FROM customers WHERE id = v_existing_row.customer_id;
      RETURN jsonb_build_object(
        'payment_id',              v_existing_row.id,
        'payment_number',          v_existing_row.payment_number,
        'allocation',              v_existing_row.allocation,
        'je_id',                   v_existing_row.journal_entry_id,
        'customer_balance_after',  COALESCE(v_balance_after, 0),
        'idempotent_replay',       TRUE
      );
    END IF;
  END IF;

  -- 3) Validate inputs
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  SELECT customer_type INTO v_customer_type
    FROM customers
   WHERE id = p_customer_id AND deleted_at IS NULL
   LIMIT 1;

  IF v_customer_type IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_type <> 'b2b' THEN
    RAISE EXCEPTION 'customer_not_b2b' USING ERRCODE = 'P0001';
  END IF;

  -- 4) Fiscal period guard (D12 helper) — raise P0004 si fermé
  PERFORM check_fiscal_period_open(p_paid_at::date);

  -- 5) Lock customer row + snapshot balance_before
  SELECT b2b_current_balance INTO v_balance_before
    FROM customers
   WHERE id = p_customer_id
   FOR UPDATE;

  v_balance_before := COALESCE(v_balance_before, 0);

  -- 6) Overpayment guard : interdit que le balance passe en négatif
  IF v_balance_before - p_amount < 0 THEN
    RAISE EXCEPTION 'overpayment_not_allowed (balance: %, amount: %)',
      v_balance_before, p_amount
      USING ERRCODE = 'P0011';
  END IF;

  v_balance_after := v_balance_before - p_amount;

  -- 7) Snapshot allocation FIFO (metadata audit only — D3) :
  --    parcourt les invoices unpaid (b2b_pending) du customer par date asc,
  --    construit un JSONB array tant que running_total < p_amount.
  --    PAS de UPDATE sur orders (allocation per-invoice = backlog S26+).
  FOR v_inv IN
    SELECT id, total, created_at
      FROM orders
     WHERE customer_id = p_customer_id
       AND order_type  = 'b2b'
       AND status      = 'b2b_pending'
       AND paid_at IS NULL
     ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_running_total >= p_amount;
    v_amount_applied := LEAST(v_inv.total, p_amount - v_running_total);
    v_allocation := v_allocation || jsonb_build_object(
      'invoice_id',    v_inv.id,
      'amount_applied', v_amount_applied
    );
    v_running_total := v_running_total + v_amount_applied;
  END LOOP;

  -- 8) Build JE : DR Cash/Bank / CR B2B_AR
  v_cash_or_bank_id := CASE
    WHEN p_method = 'cash' THEN resolve_mapping_account('SALE_PAYMENT_CASH')
    ELSE resolve_mapping_account('B2B_PAYMENT_BANK')
  END;
  v_ar_id    := resolve_mapping_account('B2B_AR');
  v_entry_no := next_journal_entry_number(p_paid_at::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, p_paid_at::date,
    'B2B payment received from customer ' || p_customer_id::text,
    'b2b_payment', NULL,                 -- reference_id rempli après INSERT b2b_payments
    'posted', p_amount, p_amount, v_profile_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_cash_or_bank_id, p_amount, 0, 'B2B payment received (' || p_method::text || ')'),
    (v_je_id, v_ar_id,           0, p_amount, 'B2B AR settlement');

  -- 9) Generate payment_number + INSERT b2b_payments
  v_payment_number := 'BP-' || to_char(p_paid_at, 'YYYY') || '-' ||
                      LPAD(nextval('b2b_payment_seq')::text, 4, '0');

  INSERT INTO b2b_payments (
    payment_number, customer_id, amount, method, reference, paid_at,
    created_by, idempotency_key, allocation, journal_entry_id, notes
  ) VALUES (
    v_payment_number, p_customer_id, p_amount, p_method, p_reference, p_paid_at,
    v_profile_id, p_idempotency_key, v_allocation, v_je_id, p_notes
  ) RETURNING id INTO v_payment_id;

  -- 10) Wire reference_id du JE → payment_id (FK update tardif)
  UPDATE journal_entries
     SET reference_id = v_payment_id
   WHERE id = v_je_id;

  -- 11) UPDATE customers.b2b_current_balance -= amount
  --     (la colonne est REVOKE UPDATE pour authenticated mais on opère ici en
  --     SECURITY DEFINER postgres owner → bypass)
  UPDATE customers
     SET b2b_current_balance = v_balance_after,
         updated_at = now()
   WHERE id = p_customer_id;

  -- 12) Audit log
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile_id, 'b2b.payment.recorded', 'b2b_payments', v_payment_id,
    jsonb_build_object(
      'amount',         p_amount,
      'method',         p_method::text,
      'customer_id',    p_customer_id,
      'balance_before', v_balance_before,
      'balance_after',  v_balance_after,
      'allocation',     v_allocation,
      'je_id',          v_je_id,
      'payment_number', v_payment_number,
      'rpc_version',    'v1'
    )
  );

  RETURN jsonb_build_object(
    'payment_id',              v_payment_id,
    'payment_number',          v_payment_number,
    'allocation',              v_allocation,
    'je_id',                   v_je_id,
    'customer_balance_after',  v_balance_after,
    'idempotent_replay',       FALSE
  );
END $func$;

REVOKE EXECUTE ON FUNCTION record_b2b_payment_v1(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_b2b_payment_v1(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION record_b2b_payment_v1(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION record_b2b_payment_v1(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID) IS
  'S24 — Enregistre un paiement B2B reçu. Émet JE (DR Cash/Bank / CR B2B_AR), '
  'décrémente customers.b2b_current_balance, INSERT b2b_payments + audit_logs. '
  'Idempotent via p_idempotency_key (UNIQUE sur b2b_payments). Allocation FIFO '
  'snapshot stockée en metadata uniquement (D3, allocation per-invoice = S26+). '
  'Errors : P0001 not_authenticated/invalid_amount/customer_not_b2b, P0002 '
  'customer_not_found, P0003 permission_denied, P0004 fiscal_period_closed, '
  'P0011 overpayment_not_allowed.';
