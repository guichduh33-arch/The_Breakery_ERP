-- 20260603000025_create_create_manual_je_v1_rpc.sql
-- Session 26 / Wave 1.I / migration _025 :
--   create_manual_je_v1(p_description, p_entry_date, p_lines, p_manager_pin) RETURNS JSONB
--
-- Saisie manuelle d une écriture comptable (Operasi Diluar — OD) pour les
-- ajustements / corrections qui ne passent par aucun trigger (salaries,
-- rent, depreciation, opening balance setup).
--
-- Validation stricte :
--   - Tous lines.account_id résolus + accounts.is_active = TRUE + is_postable = TRUE
--   - Σ debit = Σ credit
--   - entry_date >= fiscal_period 'open'
--   - PIN manager vérifié
--   - Permission accounting.je.create_manual

CREATE OR REPLACE FUNCTION public.create_manual_je_v1(
  p_description   TEXT,
  p_entry_date    DATE,
  p_lines         JSONB,
  p_manager_pin   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_je_id     UUID;
  v_entry_no  TEXT;
  v_total_debit  NUMERIC(14,2) := 0;
  v_total_credit NUMERIC(14,2) := 0;
  v_line      JSONB;
  v_acc_id    UUID;
  v_acc_row   RECORD;
  v_dr        NUMERIC(14,2);
  v_cr        NUMERIC(14,2);
  v_count     INT;
BEGIN
  IF p_description IS NULL OR length(trim(p_description)) < 3 THEN
    RAISE EXCEPTION 'description_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'entry_date_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines_array_required' USING ERRCODE = 'P0001';
  END IF;

  v_count := jsonb_array_length(p_lines);
  IF v_count < 2 THEN
    RAISE EXCEPTION 'minimum_2_lines_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT public.has_permission(v_uid, 'accounting.je.create_manual') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.verify_user_pin(v_profile, p_manager_pin) THEN
    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
  END IF;

  PERFORM check_fiscal_period_open(p_entry_date);

  -- Validation lines + sum
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_acc_id := (v_line->>'account_id')::UUID;
    v_dr     := COALESCE((v_line->>'debit')::NUMERIC(14,2), 0);
    v_cr     := COALESCE((v_line->>'credit')::NUMERIC(14,2), 0);

    IF v_acc_id IS NULL THEN
      RAISE EXCEPTION 'line_account_id_required' USING ERRCODE = 'P0001';
    END IF;
    IF v_dr < 0 OR v_cr < 0 THEN
      RAISE EXCEPTION 'line_amount_negative' USING ERRCODE = 'P0001';
    END IF;
    IF (v_dr > 0 AND v_cr > 0) OR (v_dr = 0 AND v_cr = 0) THEN
      RAISE EXCEPTION 'line_must_be_debit_xor_credit' USING ERRCODE = 'P0001';
    END IF;

    SELECT id, code, is_active, is_postable INTO v_acc_row FROM accounts WHERE id = v_acc_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_not_found: %', v_acc_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_acc_row.is_active THEN
      RAISE EXCEPTION 'account_inactive: %', v_acc_row.code USING ERRCODE = 'P0003';
    END IF;
    IF NOT v_acc_row.is_postable THEN
      RAISE EXCEPTION 'account_not_postable: %', v_acc_row.code USING ERRCODE = 'P0003';
    END IF;

    v_total_debit  := v_total_debit  + v_dr;
    v_total_credit := v_total_credit + v_cr;
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) >= 0.01 THEN
    RAISE EXCEPTION 'je_unbalanced: debit=% credit=%', v_total_debit, v_total_credit
      USING ERRCODE = 'P0001';
  END IF;

  v_entry_no := next_journal_entry_number(p_entry_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, p_entry_date,
    p_description,
    'manual',
    NULL,  -- no reference_id for OD
    'posted',
    v_total_debit, v_total_credit,
    v_profile
  ) RETURNING id INTO v_je_id;

  -- Insert lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, debit, credit, description
    ) VALUES (
      v_je_id,
      (v_line->>'account_id')::UUID,
      COALESCE((v_line->>'debit')::NUMERIC(14,2), 0),
      COALESCE((v_line->>'credit')::NUMERIC(14,2), 0),
      v_line->>'description'
    );
  END LOOP;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'accounting.je.manual_created',
    'journal_entries', v_je_id,
    jsonb_build_object(
      'entry_number', v_entry_no,
      'entry_date',   p_entry_date,
      'description',  p_description,
      'total_debit',  v_total_debit,
      'total_credit', v_total_credit,
      'line_count',   v_count
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'je_id',        v_je_id,
    'entry_number', v_entry_no,
    'entry_date',   p_entry_date,
    'total_debit',  v_total_debit,
    'total_credit', v_total_credit,
    'line_count',   v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_je_v1(TEXT, DATE, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_manual_je_v1(TEXT, DATE, JSONB, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_manual_je_v1(TEXT, DATE, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_manual_je_v1(TEXT, DATE, JSONB, TEXT) IS
  'S26 cockpit : saisie manuelle d une écriture comptable (OD). Validation stricte '
  '(account_id résolus + is_active + is_postable, balanced, lines ≥ 2). Gate '
  'accounting.je.create_manual + PIN manager + check_fiscal_period_open. '
  'reference_type=''manual'', reference_id NULL.';
