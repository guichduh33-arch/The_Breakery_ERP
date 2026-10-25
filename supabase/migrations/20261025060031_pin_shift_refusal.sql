-- Corps live conservés ; le refus PIN retourne sans annuler le compteur de sécurité.
CREATE OR REPLACE FUNCTION public.close_shift_v10(p_session_id uuid, p_counted_cash numeric, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_approver_id uuid DEFAULT NULL::uuid, p_manager_pin text DEFAULT NULL::text, p_counted_qris numeric DEFAULT NULL::numeric, p_counted_card numeric DEFAULT NULL::numeric, p_denominations jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_snapshot     JSONB;
  v_zreport_id   UUID;
  v_thr_abs      NUMERIC;
  v_thr_pct      NUMERIC;
  v_pin_thr_abs   NUMERIC;
  v_pin_thr_pct   NUMERIC;
  v_approver_auth UUID;
  v_pin_required  BOOLEAN := FALSE;
  v_denom_enabled BOOLEAN;
  v_qris_expected NUMERIC(14,2);
  v_card_expected NUMERIC(14,2);
  v_qris_variance NUMERIC(14,2);
  v_card_variance NUMERIC(14,2);
  v_denom_total   NUMERIC(14,2) := 0;
  v_denom_key     TEXT;
  v_denom_val     JSONB;
  v_note_volets   TEXT[] := ARRAY[]::TEXT[];
  v_pin_volets    TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
    RAISE EXCEPTION 'counted_cash_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_counted_qris IS NOT NULL AND p_counted_qris < 0 THEN
    RAISE EXCEPTION 'counted_method_invalid'
      USING ERRCODE = 'P0001', DETAIL = 'p_counted_qris must be >= 0';
  END IF;
  IF p_counted_card IS NOT NULL AND p_counted_card < 0 THEN
    RAISE EXCEPTION 'counted_method_invalid'
      USING ERRCODE = 'P0001', DETAIL = 'p_counted_card must be >= 0';
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
  SELECT status::text, opening_cash, cash_in_total, cash_out_total
    INTO v_status, v_opening, v_in_tot, v_out_tot
    FROM pos_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'open' THEN
    RETURN jsonb_build_object(
      'session_id', p_session_id,
      'status', v_status,
      'idempotent_replay', TRUE
    );
  END IF;
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_cash_sales
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_session_id
     AND o.status IN ('paid', 'completed')
     AND op.method = 'cash';
  -- Les voids sont déjà exclus des encaissements ; leur miroir ne se déduit pas.
  SELECT v_cash_sales - COALESCE(SUM(rp.amount), 0) INTO v_cash_sales
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
   WHERE r.session_id = p_session_id
     AND NOT r.is_full_void
     AND o.status IN ('paid', 'completed')
     AND rp.method = 'cash';
  v_expected := v_opening + v_cash_sales + v_in_tot - v_out_tot;
  v_variance := p_counted_cash - v_expected;
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_qris_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_session_id
     AND o.status IN ('paid', 'completed')
     AND op.method IN ('qris', 'gopay', 'ovo', 'dana');
  -- Les voids sont déjà exclus des encaissements ; leur miroir ne se déduit pas.
  SELECT v_qris_expected - COALESCE(SUM(rp.amount), 0) INTO v_qris_expected
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
   WHERE r.session_id = p_session_id
     AND NOT r.is_full_void
     AND o.status IN ('paid', 'completed')
     AND rp.method IN ('qris', 'gopay', 'ovo', 'dana');
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_card_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_session_id
     AND o.status IN ('paid', 'completed')
     AND op.method IN ('card', 'edc');
  -- Les voids sont déjà exclus des encaissements ; leur miroir ne se déduit pas.
  SELECT v_card_expected - COALESCE(SUM(rp.amount), 0) INTO v_card_expected
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
   WHERE r.session_id = p_session_id
     AND NOT r.is_full_void
     AND o.status IN ('paid', 'completed')
     AND rp.method IN ('card', 'edc');
  v_qris_variance := CASE WHEN p_counted_qris IS NULL THEN NULL
                          ELSE p_counted_qris - v_qris_expected END;
  v_card_variance := CASE WHEN p_counted_card IS NULL THEN NULL
                          ELSE p_counted_card - v_card_expected END;
  SELECT bc.shift_variance_threshold_abs, bc.shift_variance_threshold_pct,
         bc.shift_variance_pin_threshold_abs, bc.shift_variance_pin_threshold_pct,
         bc.shift_denomination_count_enabled
    INTO v_thr_abs, v_thr_pct, v_pin_thr_abs, v_pin_thr_pct, v_denom_enabled
  FROM business_config bc
  LIMIT 1;
  IF COALESCE(v_denom_enabled, FALSE) AND p_denominations IS NULL THEN
    RAISE EXCEPTION 'denominations_required'
      USING ERRCODE = 'P0001',
            DETAIL = 'shift_denomination_count_enabled is on; the closing cash count must provide the denomination grid';
  END IF;
  IF p_denominations IS NOT NULL THEN
    IF jsonb_typeof(p_denominations) <> 'object' THEN
      RAISE EXCEPTION 'invalid_denomination'
        USING ERRCODE = 'P0001', DETAIL = 'p_denominations must be a JSON object';
    END IF;
    FOR v_denom_key, v_denom_val IN SELECT key, value FROM jsonb_each(p_denominations) LOOP
      IF v_denom_key NOT IN ('100000','50000','20000','10000','5000','2000','1000','500','200','100') THEN
        RAISE EXCEPTION 'invalid_denomination'
          USING ERRCODE = 'P0001', DETAIL = format('unknown denomination %s', v_denom_key);
      END IF;
      IF jsonb_typeof(v_denom_val) <> 'number'
         OR (v_denom_val #>> '{}')::NUMERIC < 0
         OR (v_denom_val #>> '{}')::NUMERIC <> floor((v_denom_val #>> '{}')::NUMERIC) THEN
        RAISE EXCEPTION 'invalid_denomination'
          USING ERRCODE = 'P0001', DETAIL = format('denomination %s quantity must be a non-negative integer', v_denom_key);
      END IF;
      v_denom_total := v_denom_total + v_denom_key::NUMERIC * (v_denom_val #>> '{}')::NUMERIC;
    END LOOP;
    IF v_denom_total <> p_counted_cash THEN
      RAISE EXCEPTION 'denomination_total_mismatch'
        USING ERRCODE = 'P0001',
              DETAIL = format('denomination grid total %s does not match counted cash %s', v_denom_total, p_counted_cash);
    END IF;
  END IF;
  IF ABS(v_variance) >= COALESCE(v_thr_abs, 50000)
     OR (v_expected > 0 AND ABS(v_variance) / v_expected >= COALESCE(v_thr_pct, 0.005)) THEN
    v_note_volets := array_append(v_note_volets, 'cash');
  END IF;
  IF v_qris_variance IS NOT NULL AND (
       ABS(v_qris_variance) >= COALESCE(v_thr_abs, 50000)
       OR (v_qris_expected > 0 AND ABS(v_qris_variance) / v_qris_expected >= COALESCE(v_thr_pct, 0.005)) ) THEN
    v_note_volets := array_append(v_note_volets, 'qris');
  END IF;
  IF v_card_variance IS NOT NULL AND (
       ABS(v_card_variance) >= COALESCE(v_thr_abs, 50000)
       OR (v_card_expected > 0 AND ABS(v_card_variance) / v_card_expected >= COALESCE(v_thr_pct, 0.005)) ) THEN
    v_note_volets := array_append(v_note_volets, 'card');
  END IF;
  IF array_length(v_note_volets, 1) IS NOT NULL
     AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'variance_note_required'
      USING ERRCODE = 'P0001',
            DETAIL = format('variance exceeds threshold on volet(s) %s; a note is mandatory', array_to_string(v_note_volets, ', '));
  END IF;
  IF ABS(v_variance) >= COALESCE(v_pin_thr_abs, 200000)
     OR (v_expected > 0 AND ABS(v_variance) / v_expected >= COALESCE(v_pin_thr_pct, 0.02)) THEN
    v_pin_volets := array_append(v_pin_volets, 'cash');
  END IF;
  IF v_qris_variance IS NOT NULL AND (
       ABS(v_qris_variance) >= COALESCE(v_pin_thr_abs, 200000)
       OR (v_qris_expected > 0 AND ABS(v_qris_variance) / v_qris_expected >= COALESCE(v_pin_thr_pct, 0.02)) ) THEN
    v_pin_volets := array_append(v_pin_volets, 'qris');
  END IF;
  IF v_card_variance IS NOT NULL AND (
       ABS(v_card_variance) >= COALESCE(v_pin_thr_abs, 200000)
       OR (v_card_expected > 0 AND ABS(v_card_variance) / v_card_expected >= COALESCE(v_pin_thr_pct, 0.02)) ) THEN
    v_pin_volets := array_append(v_pin_volets, 'card');
  END IF;
  IF array_length(v_pin_volets, 1) IS NOT NULL THEN
    v_pin_required := TRUE;
    IF p_approver_id IS NULL OR COALESCE(btrim(p_manager_pin), '') = '' THEN
      RAISE EXCEPTION 'pin_approval_required'
        USING ERRCODE = 'P0001',
              DETAIL = format('variance exceeds manager-approval threshold on volet(s) %s; a designated approver and PIN are mandatory', array_to_string(v_pin_volets, ', '));
    END IF;
    SELECT up.auth_user_id INTO v_approver_auth
      FROM user_profiles up
     WHERE up.id = p_approver_id
       AND up.is_active = TRUE
       AND up.deleted_at IS NULL;
    IF v_approver_auth IS NULL
       OR NOT public.has_permission(v_approver_auth, 'shift.variance.approve') THEN
      RAISE EXCEPTION 'approver_not_authorized' USING ERRCODE = 'P0003';
    END IF;
    IF p_manager_pin !~ '^\d{6}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
    END IF;
    IF NOT public._verify_pin_with_lockout(p_approver_id, p_manager_pin) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
    END IF;
  END IF;
  PERFORM check_fiscal_period_open(v_today);
  UPDATE pos_sessions
     SET status         = 'closed',
         closed_at      = now(),
         closed_by      = v_profile,
         closing_cash   = p_counted_cash,
         expected_cash  = v_expected,
         variance_total = v_variance,
         closing_notes  = p_notes,
         variance_approved_by = CASE WHEN v_pin_required THEN p_approver_id ELSE NULL END,
         counted_qris   = p_counted_qris,
         counted_card   = p_counted_card,
         closing_denominations = p_denominations
   WHERE id = p_session_id;
  IF v_variance <> 0 THEN
    SELECT id INTO v_je_existing
      FROM journal_entries
     WHERE reference_type = 'shift_close' AND reference_id = p_session_id
     LIMIT 1;
    IF v_je_existing IS NULL THEN
      v_cash_acc  := resolve_mapping_account('SALE_PAYMENT_CASH');
      v_over_acc  := resolve_mapping_account('SHIFT_CASH_VARIANCE_INCOME');
      v_short_acc := resolve_mapping_account('SHIFT_CASH_VARIANCE_EXPENSE');
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
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_cash_acc, v_variance, 0, 'Cash overage'),
          (v_je_id, v_over_acc, 0, v_variance, 'Shift variance income (over)');
      ELSE
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_short_acc, ABS(v_variance), 0, 'Shift variance expense (short)'),
          (v_je_id, v_cash_acc,  0, ABS(v_variance), 'Cash shortage');
      END IF;
    ELSE
      v_je_id := v_je_existing;
    END IF;
  END IF;
  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
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
      'idempotency_key', p_idempotency_key,
      'variance_approved_by', CASE WHEN v_pin_required THEN p_approver_id ELSE NULL END,
      'pin_approval_required', v_pin_required,
      'counted_qris', p_counted_qris,
      'expected_qris', v_qris_expected,
      'variance_qris', v_qris_variance,
      'counted_card', p_counted_card,
      'expected_card', v_card_expected,
      'variance_card', v_card_variance,
      'denominations_provided', p_denominations IS NOT NULL
    ),
    v_profile
  );
  v_snapshot := _build_zreport_snapshot(p_session_id);
  INSERT INTO z_reports (shift_id, snapshot, status)
  VALUES (p_session_id, v_snapshot, 'draft')
  RETURNING id INTO v_zreport_id;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile,
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
    'variance_approved_by', CASE WHEN v_pin_required THEN p_approver_id ELSE NULL END,
    'counted_qris', p_counted_qris,
    'expected_qris', v_qris_expected,
    'variance_qris', v_qris_variance,
    'counted_card', p_counted_card,
    'expected_card', v_card_expected,
    'variance_card', v_card_variance,
    'idempotent_replay', FALSE
  );
END;
$function$;
DROP FUNCTION public.close_shift_v9(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb);
REVOKE ALL ON FUNCTION public.close_shift_v10(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift_v10(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
