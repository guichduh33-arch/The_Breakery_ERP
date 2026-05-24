-- 20260606000015_bump_close_shift_v2_with_zreport_draft.sql
-- S29 Wave 1.B.2 — Bump close_shift_v1 → v2 adding z_reports draft insert + audit_logs row.
-- DROP v1 in same migration (CLAUDE.md RPC versioning rule).
--
-- Changes vs v1:
--   + DECLARE v_snapshot JSONB, v_zreport_id UUID
--   + Before final RETURN: call _build_zreport_snapshot, INSERT z_reports draft,
--     INSERT audit_logs (canonical table) for zreport.draft_created
--   + Return shape extended with 'zreport_id' key
--   - Idempotency: v1 already returns early on status <> 'open', so the z_reports
--     UNIQUE(shift_id) constraint is the correct double-close guard (no ON CONFLICT needed).

CREATE OR REPLACE FUNCTION close_shift_v2(
  p_session_id      UUID,
  p_counted_cash    NUMERIC,
  p_notes           TEXT    DEFAULT NULL,
  p_idempotency_key UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      UUID;
  v_status       TEXT;
  v_opening      NUMERIC(14,2);
  v_in_tot       NUMERIC(14,2);
  v_out_tot      NUMERIC(14,2);
  v_cash_sales   NUMERIC(14,2);
  v_expected     NUMERIC(14,2);
  v_variance     NUMERIC(14,2);
  v_je_id        UUID;
  v_je_existing  UUID;
  v_entry_no     TEXT;
  v_cash_acc     UUID;
  v_over_acc     UUID;
  v_short_acc    UUID;
  v_today        DATE := CURRENT_DATE;
  -- S29 additions
  v_snapshot     JSONB;
  v_zreport_id   UUID;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
    RAISE EXCEPTION 'counted_cash_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.has_permission(v_uid, 'shift.close') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  -- Lock + read session.
  SELECT status::text, opening_cash, cash_in_total, cash_out_total
    INTO v_status, v_opening, v_in_tot, v_out_tot
    FROM pos_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'open' THEN
    -- Idempotent replay: return existing close state.
    RETURN jsonb_build_object(
      'session_id', p_session_id,
      'status', v_status,
      'idempotent_replay', TRUE
    );
  END IF;

  -- Cash sales for this session (paid orders, method='cash').
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_cash_sales
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_session_id
     AND o.status = 'paid'
     AND op.method = 'cash';

  v_expected := v_opening + v_cash_sales + v_in_tot - v_out_tot;
  v_variance := p_counted_cash - v_expected;

  -- Fiscal period guard (use today's date for variance JE).
  PERFORM check_fiscal_period_open(v_today);

  -- Persist close.
  UPDATE pos_sessions
     SET status         = 'closed',
         closed_at      = now(),
         closed_by      = v_uid,
         closing_cash   = p_counted_cash,
         expected_cash  = v_expected,
         variance_total = v_variance,
         closing_notes  = p_notes
   WHERE id = p_session_id;

  -- Emit variance JE only if non-zero.
  IF v_variance <> 0 THEN
    -- Idempotency: one JE per session for shift_close.
    SELECT id INTO v_je_existing
      FROM journal_entries
     WHERE reference_type = 'shift_close' AND reference_id = p_session_id
     LIMIT 1;

    IF v_je_existing IS NULL THEN
      v_cash_acc  := resolve_mapping_account('SALE_PAYMENT_CASH');  -- 1110
      v_over_acc  := resolve_mapping_account('SHIFT_CASH_VARIANCE_INCOME');  -- 4910
      v_short_acc := resolve_mapping_account('SHIFT_CASH_VARIANCE_EXPENSE'); -- 5910

      v_entry_no := next_journal_entry_number(v_today);

      INSERT INTO journal_entries (
        entry_number, entry_date, description, reference_type, reference_id,
        status, total_debit, total_credit, created_by
      ) VALUES (
        v_entry_no, v_today,
        'Shift close variance (session ' || p_session_id::text || ')',
        'shift_close', p_session_id, 'posted',
        ABS(v_variance), ABS(v_variance), v_profile
      ) RETURNING id INTO v_je_id;

      IF v_variance > 0 THEN
        -- OVER: DR Cash / CR variance income
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_cash_acc, v_variance, 0, 'Cash overage'),
          (v_je_id, v_over_acc, 0, v_variance, 'Shift variance income (over)');
      ELSE
        -- SHORT: DR variance expense / CR Cash
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_short_acc, ABS(v_variance), 0, 'Shift variance expense (short)'),
          (v_je_id, v_cash_acc,  0, ABS(v_variance), 'Cash shortage');
      END IF;
    ELSE
      v_je_id := v_je_existing;
    END IF;
  END IF;

  -- Legacy audit row (kept from v1 — audit_log table).
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'shift.close', 'pos_sessions', p_session_id,
    jsonb_build_object(
      'opening_cash', v_opening,
      'cash_sales',   v_cash_sales,
      'cash_in_total', v_in_tot,
      'cash_out_total', v_out_tot,
      'counted_cash', p_counted_cash,
      'expected_cash', v_expected,
      'variance', v_variance,
      'journal_entry_id', v_je_id,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  -- S29: build snapshot and insert z_reports draft row.
  v_snapshot := _build_zreport_snapshot(p_session_id);

  INSERT INTO z_reports (shift_id, snapshot, status)
  VALUES (p_session_id, v_snapshot, 'draft')
  RETURNING id INTO v_zreport_id;

  -- Canonical audit row for z_report creation (audit_logs table, S25 pattern).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_uid,
    'zreport.draft_created',
    'z_report',
    v_zreport_id,
    jsonb_build_object('shift_id', p_session_id)
  );

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'status', 'closed',
    'opening_cash', v_opening,
    'cash_sales', v_cash_sales,
    'cash_in_total', v_in_tot,
    'cash_out_total', v_out_tot,
    'counted_cash', p_counted_cash,
    'expected_cash', v_expected,
    'variance', v_variance,
    'journal_entry_id', v_je_id,
    'zreport_id', v_zreport_id,
    'idempotent_replay', FALSE
  );
END;
$$;

COMMENT ON FUNCTION close_shift_v2(UUID, NUMERIC, TEXT, UUID) IS
  'S29 bump of close_shift_v1: identical logic + inserts z_reports draft row via _build_zreport_snapshot at shift close. Returns zreport_id in addition to v1 fields. SECURITY DEFINER.';

-- Drop v1 in same migration (CLAUDE.md RPC versioning rule).
DROP FUNCTION IF EXISTS close_shift_v1(uuid, numeric, text, uuid);
