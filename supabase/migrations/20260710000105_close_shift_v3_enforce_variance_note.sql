-- 20260710000105_close_shift_v3_enforce_variance_note.sql
-- S60 (12 D1.4) — close_shift_v3 : la note d'écart devient obligatoire cote
-- serveur des que |variance| depasse le seuil configure
-- (business_config.shift_variance_threshold_abs/pct), au lieu d'un simple
-- badge UI (VarianceWarningBadge) contournable via un appel RPC direct.
--
-- DEV-S57-02 : ce corps est copie DEPUIS LE LIVE via
--   SELECT pg_get_functiondef('public.close_shift_v2(uuid,numeric,text,uuid)'::regprocedure);
-- Le fichier de migration d'origine (20260606000015) est DRIFTE : il ecrit
-- dans la vue 'audit_log' (droppee en S56) ; le corps live ecrit deja dans
-- 'audit_logs' — ce bump repart du live, jamais du fichier historique.

CREATE OR REPLACE FUNCTION public.close_shift_v3(
  p_session_id uuid,
  p_counted_cash numeric,
  p_notes text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
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
    -- never needs a note (S60).
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
  SELECT bc.shift_variance_threshold_abs, bc.shift_variance_threshold_pct
    INTO v_thr_abs, v_thr_pct
  FROM business_config bc
  LIMIT 1;
  IF ( ABS(v_variance) >= COALESCE(v_thr_abs, 50000)
       OR (v_expected > 0 AND ABS(v_variance) / v_expected >= COALESCE(v_thr_pct, 0.005)) )
     AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'variance_note_required'
      USING ERRCODE = 'P0001',
            DETAIL = format('variance %s exceeds threshold; a note is mandatory', v_variance);
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
$function$;

DROP FUNCTION public.close_shift_v2(uuid, numeric, text, uuid);

-- S20 trio: anon defense-in-depth (Supabase auto-grants EXECUTE to PUBLIC,
-- which anon inherits — REVOKE both explicitly). The POS calls v3 with a
-- direct user JWT, so `authenticated` keeps EXECUTE.
REVOKE ALL ON FUNCTION public.close_shift_v3(uuid, numeric, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_shift_v3(uuid, numeric, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_shift_v3(uuid, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.close_shift_v3(uuid, numeric, text, uuid) IS
  'S60 (12 D1.4): bump of close_shift_v2 (dropped in this migration) — the '
  'variance note is now enforced server-side. When |variance| exceeds '
  'business_config.shift_variance_threshold_abs/pct and p_notes is blank, '
  'raises variance_note_required (ERRCODE P0001). Mirrors the client-side '
  'predicate in VarianceWarningBadge.tsx (shouldShowWarning). The idempotent '
  '-replay branch (session already closed) returns before the guard, so a '
  'replay never requires a note.';
