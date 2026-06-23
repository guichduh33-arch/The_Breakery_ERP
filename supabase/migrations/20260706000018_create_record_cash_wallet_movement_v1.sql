-- 20260706000018 — record_cash_wallet_movement_v1 : single balanced-JE poster for cash wallets.
-- Also extends journal_entries.reference_type to allow 'cash_movement'.
-- NOTE on naming: the function is record_cash_WALLET_movement_v1 (not record_cash_movement_v1)
-- to avoid colliding with the pre-existing in-shift record_cash_movement family
-- (record_cash_movement_v2(uuid,text,numeric,text,uuid,text)). On cloud this was reached via a
-- create-then-rename pair; this file declares the correct final name directly for fresh replays.

-- (a) Allow the new reference_type discriminator.
ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_reference_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_reference_type_check
  CHECK (
    reference_type IS NULL OR reference_type = ANY (ARRAY[
      'sale','sale_void','sale_refund','purchase','purchase_return','purchase_payment',
      'expense','expense_payment','shift_close','adjustment','waste','opname','production',
      'transfer','manual','pos_outstanding','pos_outstanding_payment','stock_movement',
      'void','refund','cash_movement'
    ])
  );

-- (b) Idempotency ledger.
CREATE TABLE IF NOT EXISTS cash_movement_idempotency_keys (
  idempotency_key UUID PRIMARY KEY,
  je_id           UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cash_movement_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cash_movement_idempotency_keys FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE cash_movement_idempotency_keys FROM authenticated;
GRANT SELECT ON TABLE cash_movement_idempotency_keys TO authenticated;
DROP POLICY IF EXISTS cash_movement_idem_select_auth ON cash_movement_idempotency_keys;
CREATE POLICY cash_movement_idem_select_auth ON cash_movement_idempotency_keys
  FOR SELECT TO authenticated USING (true);

-- (c) The poster.
CREATE OR REPLACE FUNCTION record_cash_wallet_movement_v1(
  p_movement_type   TEXT,
  p_amount          NUMERIC,
  p_movement_date   DATE,
  p_remark          TEXT,
  p_idempotency_key UUID,
  p_wallet_code     TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_existing   UUID;
  v_dr_key     TEXT;
  v_cr_key     TEXT;
  v_dr_acc     UUID;
  v_cr_acc     UUID;
  v_wallet_key TEXT;
  v_entry_no   TEXT;
  v_je_id      UUID;
  v_label      TEXT;
BEGIN
  -- Permission gate (defense in depth on top of UI gate)
  IF NOT public.has_permission(v_uid, 'accounting.cash.write') THEN
    RAISE EXCEPTION 'permission_denied: accounting.cash.write required' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency replay
  SELECT je_id INTO v_existing FROM cash_movement_idempotency_keys
    WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Resolve the wallet mapping key for adjustments
  IF p_movement_type IN ('adjustment_gain', 'adjustment_loss') THEN
    v_wallet_key := CASE p_wallet_code
      WHEN '1110' THEN 'CASH_WALLET_UNDEPOSITED'
      WHEN '1111' THEN 'CASH_WALLET_PETTY'
      WHEN '1117' THEN 'CASH_WALLET_SMALL_MONEY'
      ELSE NULL END;
    IF v_wallet_key IS NULL THEN
      RAISE EXCEPTION 'adjustment requires p_wallet_code in (1110,1111,1117)' USING ERRCODE = 'P0001';
    END IF;
    IF p_remark IS NULL OR length(trim(p_remark)) = 0 THEN
      RAISE EXCEPTION 'adjustment requires a remark (reason)' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Map movement type → (debit key, credit key)
  SELECT dr, cr, lbl INTO v_dr_key, v_cr_key, v_label FROM (VALUES
    ('undepo_to_petty',  'CASH_WALLET_PETTY',          'CASH_WALLET_UNDEPOSITED',     'Transfer Undeposited → Petty Cash'),
    ('petty_to_undepo',  'CASH_WALLET_UNDEPOSITED',    'CASH_WALLET_PETTY',           'Transfer Petty Cash → Undeposited'),
    ('bank_deposit',     'CASH_BANK_OPERATING',        'CASH_WALLET_UNDEPOSITED',     'Bank deposit'),
    ('boss_withdrawal',  'OWNER_DRAWING',              'CASH_WALLET_UNDEPOSITED',     'Boss withdrawal'),
    ('small_money_lend', 'CASH_WALLET_UNDEPOSITED',    'CASH_WALLET_SMALL_MONEY',     'Small Money lends to Undeposited'),
    ('small_money_repay','CASH_WALLET_SMALL_MONEY',    'CASH_WALLET_UNDEPOSITED',     'Repay Small Money'),
    ('adjustment_gain',  v_wallet_key,                 'SHIFT_CASH_VARIANCE_INCOME',  'Cash count overage'),
    ('adjustment_loss',  'SHIFT_CASH_VARIANCE_EXPENSE', v_wallet_key,                 'Cash count shortage')
  ) AS m(mt, dr, cr, lbl) WHERE m.mt = p_movement_type;

  IF v_dr_key IS NULL OR v_cr_key IS NULL THEN
    RAISE EXCEPTION 'unknown movement_type: %', p_movement_type USING ERRCODE = 'P0001';
  END IF;

  -- Fiscal guard
  PERFORM check_fiscal_period_open(p_movement_date);

  v_dr_acc := resolve_mapping_account(v_dr_key);
  v_cr_acc := resolve_mapping_account(v_cr_key);
  v_entry_no := next_journal_entry_number(p_movement_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, p_movement_date,
    v_label || COALESCE(' — ' || left(p_remark, 80), ''),
    'cash_movement', p_idempotency_key,
    'posted', p_amount, p_amount, v_uid
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_dr_acc, p_amount, 0, COALESCE(p_remark, v_label)),
    (v_je_id, v_cr_acc, 0, p_amount, COALESCE(p_remark, v_label));

  INSERT INTO cash_movement_idempotency_keys (idempotency_key, je_id)
    VALUES (p_idempotency_key, v_je_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'cash.wallet_movement', 'journal_entries', v_je_id,
          jsonb_build_object('movement_type', p_movement_type, 'amount', p_amount,
                             'date', p_movement_date, 'remark', p_remark));

  RETURN v_je_id;
EXCEPTION WHEN unique_violation THEN
  -- Concurrent replay race: re-read the winner.
  SELECT je_id INTO v_existing FROM cash_movement_idempotency_keys
    WHERE idempotency_key = p_idempotency_key;
  RETURN v_existing;
END $$;

COMMENT ON FUNCTION record_cash_wallet_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) IS
  'Cash Wallets : posts one balanced JE for a wallet movement (Undeposited/Petty/Small Money). '
  'Idempotent on p_idempotency_key. Gated by accounting.cash.write. Fiscal-period guarded. '
  'Distinct from the in-shift record_cash_movement_v2(uuid,text,numeric,text,uuid,text).';

REVOKE EXECUTE ON FUNCTION record_cash_wallet_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_cash_wallet_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION record_cash_wallet_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) TO authenticated;
-- Project anon defense-in-depth (S20): ensure future public functions default-revoked from PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
