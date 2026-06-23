-- 20260706000022 — Cash Wallets : stricter role for adjustments + boss withdrawal (spec §3/§6).
-- adjustment_gain/adjustment_loss/boss_withdrawal now require accounting.cash.adjust
-- (granted to ADMIN/SUPER_ADMIN only), on top of the base accounting.cash.write gate.

INSERT INTO permissions (code, module, action, description) VALUES
  ('accounting.cash.adjust', 'accounting', 'cash.adjust',
   'Book a cash adjustment (over/short) or a Boss withdrawal — stricter than cash.write')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('ADMIN',       'accounting.cash.adjust'),
  ('SUPER_ADMIN', 'accounting.cash.adjust')
ON CONFLICT DO NOTHING;

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
  -- Base permission gate (defense in depth on top of UI gate)
  IF NOT public.has_permission(v_uid, 'accounting.cash.write') THEN
    RAISE EXCEPTION 'permission_denied: accounting.cash.write required' USING ERRCODE = 'P0001';
  END IF;

  -- Stricter gate for adjustments + Boss withdrawal (spec §3/§6).
  IF p_movement_type IN ('adjustment_gain', 'adjustment_loss', 'boss_withdrawal') THEN
    IF NOT public.has_permission(v_uid, 'accounting.cash.adjust') THEN
      RAISE EXCEPTION 'permission_denied: accounting.cash.adjust required for %', p_movement_type
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  SELECT je_id INTO v_existing FROM cash_movement_idempotency_keys
    WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

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
  SELECT je_id INTO v_existing FROM cash_movement_idempotency_keys
    WHERE idempotency_key = p_idempotency_key;
  RETURN v_existing;
END $$;

REVOKE EXECUTE ON FUNCTION record_cash_wallet_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_cash_wallet_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION record_cash_wallet_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
