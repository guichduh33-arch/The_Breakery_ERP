-- 20260603000016_bump_record_cash_movement_v2_emit_je.sql
-- Session 26 / Wave 1.F / migration _016 :
--   record_cash_movement_v2 : ajoute p_reason_code TEXT (DEFAULT NULL) qui
--   route l émission d une JE selon le cas business.
--
-- Closes audit finding F-S26-AC-03.
--
-- Avant (v1) : table cash_movements mise à jour + pos_sessions.cash_in/out_total
--   incrementés MAIS aucune JE émise → comptablement, l apport d argent
--   en caisse par le propriétaire n a aucune contrepartie. Le Balance Sheet
--   sous-affichait Cash 1110 vs réalité physique entre 2 shift closes.
--
-- Après (v2) : si p_reason_code IS NOT NULL, émet aussi une JE :
--   reason_code = 'apport_owner'      (direction='in')  → DR 1110 / CR 3100
--   reason_code = 'bank_transfer'     (direction='in')  → DR 1110 / CR 1112
--   reason_code = 'bank_transfer'     (direction='out') → DR 1112 / CR 1110
--   reason_code = 'replenishment'                       → no JE (rotation cash interne)
--   reason_code = 'misc' ou NULL                        → no JE (backward compat)
--
-- Idempotency : si p_idempotency_key déjà vu, retourne le mvt existant
-- (replay) — mais ne ré-émet PAS de JE (la JE de la 1ère exécution est
-- déjà postée et liée par reference_id = movement_id).
--
-- Signature change : on ajoute p_reason_code à la fin avec DEFAULT NULL
-- pour ne pas casser les appelants existants qui n envoient pas ce paramètre.
-- DROP de v1 dans la même migration (CLAUDE.md RPC versioning).
--
-- Note : on ajoute aussi cash_movements.reason_code TEXT NULL pour traçabilité.

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS reason_code TEXT
    CHECK (reason_code IS NULL OR reason_code IN
      ('apport_owner', 'bank_transfer', 'replenishment', 'misc'));

DROP FUNCTION IF EXISTS public.record_cash_movement_v1(UUID, TEXT, NUMERIC, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.record_cash_movement_v2(
  p_session_id      UUID,
  p_direction       TEXT,
  p_amount          NUMERIC,
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL,
  p_reason_code     TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_status   TEXT;
  v_mvt_id   UUID;
  v_in_tot   NUMERIC(14,2);
  v_out_tot  NUMERIC(14,2);
  v_session_date DATE;
  v_je_id    UUID;
  v_entry_no TEXT;
  v_cash_id  UUID;
  v_capital_id UUID;
  v_bank_id  UUID;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'invalid_direction' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code NOT IN
    ('apport_owner', 'bank_transfer', 'replenishment', 'misc') THEN
    RAISE EXCEPTION 'invalid_reason_code' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.has_permission(v_uid, 'shift.cash_movement') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  -- Idempotency replay
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id FROM cash_movements
      WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      SELECT cash_in_total, cash_out_total
        INTO v_in_tot, v_out_tot
        FROM pos_sessions WHERE id = p_session_id;
      RETURN jsonb_build_object(
        'movement_id', v_mvt_id,
        'session_id', p_session_id,
        'cash_in_total', v_in_tot,
        'cash_out_total', v_out_tot,
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  SELECT status INTO v_status FROM pos_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status::text <> 'open' THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO cash_movements (session_id, direction, amount, reason, reason_code, idempotency_key, created_by)
  VALUES (p_session_id, p_direction, p_amount, p_reason, p_reason_code, p_idempotency_key, v_profile)
  RETURNING id INTO v_mvt_id;

  IF p_direction = 'in' THEN
    UPDATE pos_sessions SET cash_in_total = cash_in_total + p_amount WHERE id = p_session_id;
  ELSE
    UPDATE pos_sessions SET cash_out_total = cash_out_total + p_amount WHERE id = p_session_id;
  END IF;

  -- F-S26-AC-03 : émission JE selon reason_code
  IF p_reason_code IS NOT NULL AND p_reason_code IN ('apport_owner', 'bank_transfer') THEN
    PERFORM check_fiscal_period_open(CURRENT_DATE);
    v_session_date := CURRENT_DATE;
    v_entry_no := next_journal_entry_number(v_session_date);

    v_cash_id    := resolve_mapping_account('SALE_PAYMENT_CASH');
    v_capital_id := resolve_mapping_account('CASH_MOVEMENT_OWNER_CAPITAL');
    v_bank_id    := resolve_mapping_account('CASH_MOVEMENT_BANK');

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, v_session_date,
      'Cash movement: ' || p_reason_code || ' (' || p_direction || ' ' || p_amount::TEXT || ') — ' || p_reason,
      'cash_movement', v_mvt_id,
      'posted', p_amount, p_amount, v_profile
    ) RETURNING id INTO v_je_id;

    IF p_reason_code = 'apport_owner' THEN
      -- Owner injects cash : DR 1110 Cash / CR 3100 Owner Capital
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_cash_id,    p_amount, 0,        'Cash injection by owner'),
        (v_je_id, v_capital_id, 0,        p_amount, 'Owner capital contribution');
    ELSIF p_reason_code = 'bank_transfer' THEN
      IF p_direction = 'in' THEN
        -- Bank → Cash (e.g., manager refills shift from bank)
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_cash_id, p_amount, 0,        'Cash refill from bank'),
          (v_je_id, v_bank_id, 0,        p_amount, 'Bank withdrawal for cash float');
      ELSE
        -- Cash → Bank (e.g., manager deposits excess cash to bank)
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_bank_id, p_amount, 0,        'Bank deposit from cash'),
          (v_je_id, v_cash_id, 0,        p_amount, 'Cash deposited to bank');
      END IF;
    END IF;
  END IF;

  SELECT cash_in_total, cash_out_total INTO v_in_tot, v_out_tot
    FROM pos_sessions WHERE id = p_session_id;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'shift.cash_movement', 'cash_movements', v_mvt_id,
    jsonb_build_object(
      'session_id', p_session_id,
      'direction', p_direction,
      'amount', p_amount,
      'reason', p_reason,
      'reason_code', p_reason_code,
      'je_id', v_je_id,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'movement_id', v_mvt_id,
    'session_id', p_session_id,
    'cash_in_total', v_in_tot,
    'cash_out_total', v_out_tot,
    'je_id', v_je_id,
    'idempotent_replay', FALSE
  );
END $$;

REVOKE ALL ON FUNCTION public.record_cash_movement_v2(UUID, TEXT, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_cash_movement_v2(UUID, TEXT, NUMERIC, TEXT, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_cash_movement_v2(UUID, TEXT, NUMERIC, TEXT, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.record_cash_movement_v2(UUID, TEXT, NUMERIC, TEXT, UUID, TEXT) IS
  'F-S26-AC-03 : ajoute p_reason_code qui route l émission d une JE selon le cas '
  'business. apport_owner (DR 1110/CR 3100), bank_transfer (DR/CR 1110↔1112), '
  'replenishment ou misc (no JE). Drop v1 dans la même migration. POS hook à '
  'migrer dans le même PR (Wave 1.F.2).';
