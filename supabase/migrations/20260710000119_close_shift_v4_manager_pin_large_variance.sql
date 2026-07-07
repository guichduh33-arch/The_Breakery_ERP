-- 20260710000119_close_shift_v4_manager_pin_large_variance.sql
-- S66 (fiche 12 D2.1 / B1.4) — close_shift_v4 : au-delà d'un second seuil
-- d'écart (business_config.shift_variance_pin_threshold_abs/pct, défauts
-- 200 000 IDR / 2 %), la clôture exige un approbateur manager DÉSIGNÉ
-- (p_approver_id = user_profiles.id, choisi dans un picker POS) + son PIN
-- 6 chiffres, validé serveur via _verify_pin_with_lockout (S38 — lockout
-- 5 échecs / 15 min ciblé sur le manager désigné ; PAS de matching anonyme,
-- qui interdirait tout lockout par compte, cf. warning manager-pin.ts).
--
-- Codes d'erreur (nouveaux, tous AVANT toute écriture) :
--   pin_approval_required  P0001 — sur-seuil PIN sans approbateur/PIN fournis
--   approver_not_authorized P0003 — approbateur introuvable/inactif/supprimé/
--                                   sans auth ou sans shift.variance.approve
--   invalid_pin            P0003 — format non 6-chiffres (non compté, miroir
--                                   manager-pin.ts) ou PIN faux (compté+lockout)
--   account_locked         P0004 — remonte tel quel du helper
--
-- La garde note S60 (variance_note_required) est inchangée et indépendante :
-- avec les défauts, le seuil PIN est au-dessus du seuil note (note dès 50k,
-- PIN dès 200k). Le replay idempotent (session non-open) sort AVANT les deux
-- gardes — un replay n'exige ni note ni PIN.
--
-- PIN en arg RPC (appel direct POS, pas via EF) — conforme au pattern projet
-- (void_zreport_v2, sign_zreport_v2) ; la règle « PIN en header » ne vise que
-- les Edge Functions.
--
-- DEV-S57-02 : ce corps est repris DU LIVE via
--   SELECT pg_get_functiondef('public.close_shift_v3(uuid,numeric,text,uuid)'::regprocedure);
-- (vérifié identique au fichier _105 le 2026-07-07), jamais du fichier historique.

CREATE OR REPLACE FUNCTION public.close_shift_v4(
  p_session_id uuid,
  p_counted_cash numeric,
  p_notes text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_approver_id uuid DEFAULT NULL::uuid,
  p_manager_pin text DEFAULT NULL::text
)
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
  -- S29 additions
  v_snapshot     JSONB;
  v_zreport_id   UUID;
  -- S60 (12 D1.4) additions
  v_thr_abs      NUMERIC;
  v_thr_pct      NUMERIC;
  -- S66 (12 D2.1) additions
  v_pin_thr_abs   NUMERIC;
  v_pin_thr_pct   NUMERIC;
  v_approver_auth UUID;
  v_pin_required  BOOLEAN := FALSE;
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
    -- Idempotent replay: return existing close state. MUST run before the
    -- variance-note guard below — a replay on an already-closed session
    -- never needs a note (S60) nor a manager PIN (S66).
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

  -- S60 (12 D1.4): variance note enforced server-side (was UI-only, bypassable via direct RPC)
  -- S66 (12 D2.1): same SELECT also pulls the manager-PIN thresholds.
  SELECT bc.shift_variance_threshold_abs, bc.shift_variance_threshold_pct,
         bc.shift_variance_pin_threshold_abs, bc.shift_variance_pin_threshold_pct
    INTO v_thr_abs, v_thr_pct, v_pin_thr_abs, v_pin_thr_pct
  FROM business_config bc
  LIMIT 1;
  IF ( ABS(v_variance) >= COALESCE(v_thr_abs, 50000)
       OR (v_expected > 0 AND ABS(v_variance) / v_expected >= COALESCE(v_thr_pct, 0.005)) )
     AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'variance_note_required'
      USING ERRCODE = 'P0001',
            DETAIL = format('variance %s exceeds threshold; a note is mandatory', v_variance);
  END IF;

  -- S66 (12 D2.1): above the (higher) PIN threshold, a designated manager must
  -- approve with their PIN. Independent from the note guard above.
  IF ( ABS(v_variance) >= COALESCE(v_pin_thr_abs, 200000)
       OR (v_expected > 0 AND ABS(v_variance) / v_expected >= COALESCE(v_pin_thr_pct, 0.02)) ) THEN
    v_pin_required := TRUE;

    IF p_approver_id IS NULL OR COALESCE(btrim(p_manager_pin), '') = '' THEN
      RAISE EXCEPTION 'pin_approval_required'
        USING ERRCODE = 'P0001',
              DETAIL = format('variance %s exceeds manager-approval threshold; a designated approver and PIN are mandatory', v_variance);
    END IF;

    -- Resolve the approver and check the dedicated permission (via their auth
    -- uid so user_permission_overrides are honoured by has_permission).
    SELECT up.auth_user_id INTO v_approver_auth
      FROM user_profiles up
     WHERE up.id = p_approver_id
       AND up.is_active = TRUE
       AND up.deleted_at IS NULL;
    IF v_approver_auth IS NULL
       OR NOT public.has_permission(v_approver_auth, 'shift.variance.approve') THEN
      RAISE EXCEPTION 'approver_not_authorized' USING ERRCODE = 'P0003';
    END IF;

    -- 6-digit format check BEFORE the lockout helper: format typos are not
    -- brute-force signals and must not consume failed attempts (mirror of
    -- manager-pin.ts, which skips the fail bucket on invalid_pin_format).
    IF p_manager_pin !~ '^\d{6}$' THEN
      RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
    END IF;
    IF NOT public._verify_pin_with_lockout(p_approver_id, p_manager_pin) THEN
      RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
    END IF;
  END IF;

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
         closing_notes  = p_notes,
         variance_approved_by = CASE WHEN v_pin_required THEN p_approver_id ELSE NULL END
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
      'pin_approval_required', v_pin_required
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
    'variance_approved_by', CASE WHEN v_pin_required THEN p_approver_id ELSE NULL END,
    'idempotent_replay', FALSE
  );
END;
$function$;

DROP FUNCTION public.close_shift_v3(uuid, numeric, text, uuid);

-- S20 trio: anon defense-in-depth (Supabase auto-grants EXECUTE to PUBLIC,
-- which anon inherits — REVOKE both explicitly). The POS calls v4 with a
-- direct user JWT, so `authenticated` keeps EXECUTE.
REVOKE ALL ON FUNCTION public.close_shift_v4(uuid, numeric, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_shift_v4(uuid, numeric, text, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_shift_v4(uuid, numeric, text, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.close_shift_v4(uuid, numeric, text, uuid, uuid, text) IS
  'S66 (12 D2.1): bump of close_shift_v3 (dropped in this migration). Above '
  'business_config.shift_variance_pin_threshold_abs/pct (defaults 200000 IDR / '
  '2%), the close requires a DESIGNATED approver (p_approver_id = '
  'user_profiles.id holding shift.variance.approve) plus their 6-digit PIN, '
  'validated via _verify_pin_with_lockout (5 fails / 15 min lockout on the '
  'approver). Errors: pin_approval_required (P0001), approver_not_authorized '
  '(P0003), invalid_pin (P0003), account_locked (P0004). The S60 '
  'variance_note_required guard is unchanged and independent. The idempotent '
  'replay branch returns before both guards.';
