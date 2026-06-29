-- 20260710000067_record_b2b_payment_v2.sql
-- S52 P1.2 (C3) — record_b2b_payment v1 -> v2.
-- v1 wrote a metadata-only JSONB allocation snapshot and never touched orders.paid_at, so
-- view_b2b_invoices.is_unpaid stayed TRUE forever. v2 writes REAL rows into
-- b2b_payment_allocations, sets orders.paid_at + status='paid' on full settlement, and
-- supports targeted invoice allocation (p_invoice_ids, honoring array order) with a FIFO
-- fallback for any remainder. Gate moves from generic customers.update to b2b.payment.record.
-- New arg appended (p_invoice_ids), signature otherwise identical to v1. DROP v1 same migration.

CREATE OR REPLACE FUNCTION public.record_b2b_payment_v2(
  p_customer_id     UUID,
  p_amount          NUMERIC,
  p_method          payment_method,
  p_reference       TEXT          DEFAULT NULL,
  p_paid_at         TIMESTAMPTZ   DEFAULT now(),
  p_notes           TEXT          DEFAULT NULL,
  p_idempotency_key UUID          DEFAULT NULL,
  p_invoice_ids     UUID[]        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile_id       UUID;
  v_customer_type    customer_type;
  v_balance_before   NUMERIC(14,2);
  v_balance_after    NUMERIC(14,2);
  v_existing_row     b2b_payments%ROWTYPE;
  v_payment_id       UUID;
  v_payment_number   TEXT;
  v_je_id            UUID;
  v_entry_no         TEXT;
  v_cash_or_bank_id  UUID;
  v_ar_id            UUID;
  -- allocation
  v_remaining        NUMERIC(14,2);
  v_apply            NUMERIC(14,2);
  v_alloc_json       JSONB := '[]'::jsonb;
  v_target_id        UUID;
  v_fully            BOOLEAN;
  v_inv              RECORD;
BEGIN
  -- 1) Auth + profile
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile_id
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 2) Dedicated gate (S52) — plus le générique customers.update
  IF NOT has_permission(v_uid, 'b2b.payment.record') THEN
    RAISE EXCEPTION 'permission_denied: b2b.payment.record' USING ERRCODE = 'P0003';
  END IF;

  -- 3) Idempotency replay — return first result + reconstruct allocations from the ledger
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_row
      FROM b2b_payments WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      SELECT b2b_current_balance INTO v_balance_after
        FROM customers WHERE id = v_existing_row.customer_id;
      RETURN jsonb_build_object(
        'payment_id',             v_existing_row.id,
        'payment_number',         v_existing_row.payment_number,
        'allocations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('invoice_id', a.invoice_id, 'amount_applied', a.amount_applied))
            FROM b2b_payment_allocations a WHERE a.payment_id = v_existing_row.id), '[]'::jsonb),
        'allocation',             v_existing_row.allocation,
        'je_id',                  v_existing_row.journal_entry_id,
        'customer_balance_after', COALESCE(v_balance_after, 0),
        'idempotent_replay',      TRUE
      );
    END IF;
  END IF;

  -- 4) Validate inputs
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  SELECT customer_type INTO v_customer_type
    FROM customers WHERE id = p_customer_id AND deleted_at IS NULL LIMIT 1;
  IF v_customer_type IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_type <> 'b2b' THEN
    RAISE EXCEPTION 'customer_not_b2b' USING ERRCODE = 'P0001';
  END IF;

  -- 5) Fiscal period guard
  PERFORM check_fiscal_period_open(p_paid_at::date);

  -- 6) Lock customer + snapshot balance, overpayment guard
  SELECT b2b_current_balance INTO v_balance_before
    FROM customers WHERE id = p_customer_id FOR UPDATE;
  v_balance_before := COALESCE(v_balance_before, 0);
  IF v_balance_before - p_amount < 0 THEN
    RAISE EXCEPTION 'overpayment_not_allowed (balance: %, amount: %)',
      v_balance_before, p_amount USING ERRCODE = 'P0011';
  END IF;
  v_balance_after := v_balance_before - p_amount;

  -- 7) JE : DR Cash/Bank / CR B2B_AR
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
    'b2b_payment', NULL, 'posted', p_amount, p_amount, v_profile_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_cash_or_bank_id, p_amount, 0, 'B2B payment received (' || p_method::text || ')'),
    (v_je_id, v_ar_id,           0, p_amount, 'B2B AR settlement');

  -- 8) INSERT b2b_payments (allocation snapshot filled after the loops)
  v_payment_number := 'BP-' || to_char(p_paid_at, 'YYYY') || '-' ||
                      LPAD(nextval('b2b_payment_seq')::text, 4, '0');

  INSERT INTO b2b_payments (
    payment_number, customer_id, amount, method, reference, paid_at,
    created_by, idempotency_key, allocation, journal_entry_id, notes
  ) VALUES (
    v_payment_number, p_customer_id, p_amount, p_method, p_reference, p_paid_at,
    v_profile_id, p_idempotency_key, '[]'::jsonb, v_je_id, p_notes
  ) RETURNING id INTO v_payment_id;

  UPDATE journal_entries SET reference_id = v_payment_id WHERE id = v_je_id;

  -- 9) Balance cache decrement
  UPDATE customers SET b2b_current_balance = v_balance_after, updated_at = now()
   WHERE id = p_customer_id;

  -- 10) Allocation : targeted (array order) then FIFO remainder
  v_remaining := p_amount;

  IF p_invoice_ids IS NOT NULL THEN
    FOREACH v_target_id IN ARRAY p_invoice_ids LOOP
      EXIT WHEN v_remaining <= 0;
      SELECT o.id,
             o.total - COALESCE((SELECT SUM(a.amount_applied)
                                   FROM b2b_payment_allocations a WHERE a.invoice_id = o.id), 0) AS outstanding
        INTO v_inv
        FROM orders o
       WHERE o.id = v_target_id
         AND o.customer_id = p_customer_id
         AND o.order_type = 'b2b'
         AND o.status <> 'voided'
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_target_invoice: %', v_target_id USING ERRCODE = 'P0001';
      END IF;
      IF v_inv.outstanding <= 0 THEN
        RAISE EXCEPTION 'target_invoice_already_settled: %', v_target_id USING ERRCODE = 'P0001';
      END IF;
      v_apply := LEAST(v_inv.outstanding, v_remaining);
      INSERT INTO b2b_payment_allocations (payment_id, invoice_id, amount_applied)
        VALUES (v_payment_id, v_target_id, v_apply);
      IF v_apply >= v_inv.outstanding THEN
        UPDATE orders SET paid_at = p_paid_at, status = 'paid' WHERE id = v_target_id;
        v_fully := TRUE;
      ELSE
        v_fully := FALSE;
      END IF;
      v_alloc_json := v_alloc_json || jsonb_build_object(
        'invoice_id', v_target_id, 'amount_applied', v_apply, 'fully_settled', v_fully);
      v_remaining := v_remaining - v_apply;
    END LOOP;
  END IF;

  -- FIFO remainder over oldest unpaid b2b invoices not already touched this call
  FOR v_inv IN
    SELECT o.id,
           o.total - COALESCE((SELECT SUM(a.amount_applied)
                                 FROM b2b_payment_allocations a WHERE a.invoice_id = o.id), 0) AS outstanding
      FROM orders o
     WHERE o.customer_id = p_customer_id
       AND o.order_type  = 'b2b'
       AND o.status      = 'b2b_pending'
     ORDER BY o.created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN v_inv.outstanding <= 0;
    CONTINUE WHEN EXISTS (SELECT 1 FROM b2b_payment_allocations a
                           WHERE a.payment_id = v_payment_id AND a.invoice_id = v_inv.id);
    v_apply := LEAST(v_inv.outstanding, v_remaining);
    INSERT INTO b2b_payment_allocations (payment_id, invoice_id, amount_applied)
      VALUES (v_payment_id, v_inv.id, v_apply);
    IF v_apply >= v_inv.outstanding THEN
      UPDATE orders SET paid_at = p_paid_at, status = 'paid' WHERE id = v_inv.id;
      v_fully := TRUE;
    ELSE
      v_fully := FALSE;
    END IF;
    v_alloc_json := v_alloc_json || jsonb_build_object(
      'invoice_id', v_inv.id, 'amount_applied', v_apply, 'fully_settled', v_fully);
    v_remaining := v_remaining - v_apply;
  END LOOP;

  -- 11) Persist legacy snapshot for continuity
  UPDATE b2b_payments SET allocation = v_alloc_json WHERE id = v_payment_id;

  -- 12) Audit
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile_id, 'b2b.payment.recorded', 'b2b_payments', v_payment_id,
    jsonb_build_object(
      'amount', p_amount, 'method', p_method::text, 'customer_id', p_customer_id,
      'balance_before', v_balance_before, 'balance_after', v_balance_after,
      'allocation', v_alloc_json, 'je_id', v_je_id, 'payment_number', v_payment_number,
      'rpc_version', 'v2'
    )
  );

  RETURN jsonb_build_object(
    'payment_id',             v_payment_id,
    'payment_number',         v_payment_number,
    'allocations',            v_alloc_json,
    'allocation',             v_alloc_json,
    'je_id',                  v_je_id,
    'customer_balance_after', v_balance_after,
    'idempotent_replay',      FALSE
  );
END $func$;

DROP FUNCTION IF EXISTS public.record_b2b_payment_v1(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID);

REVOKE ALL ON FUNCTION public.record_b2b_payment_v2(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_b2b_payment_v2(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID, UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_b2b_payment_v2(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID, UUID[]) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.record_b2b_payment_v2(UUID, NUMERIC, payment_method, TEXT, TIMESTAMPTZ, TEXT, UUID, UUID[]) IS
  'S52 P1.2 — B2B payment with real per-invoice allocation (b2b_payment_allocations). '
  'Targeted via p_invoice_ids (array order) then FIFO remainder; sets orders.paid_at + '
  'status=paid on full settlement (closes C3). Gate b2b.payment.record. Idempotent via '
  'p_idempotency_key. Errors: P0001/P0002/P0003/P0004/P0011.';
