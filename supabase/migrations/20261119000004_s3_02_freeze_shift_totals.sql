-- S3-02 — Figer les totaux à la clôture de session (master plan de finition,
-- arbitrage §2bis lot 2 ; RÈGLE de SPECS_OFFICIELS_ERP_POS.md §6.3).
--
-- Partie ADDITIVE. Trois colonnes neuves sur pos_sessions, renseignées par
-- close_shift_v15 au moment de la clôture :
--   closing_payment_totals — encaissements nets par moyen de paiement, la même
--                            somme que totals_by_payment_method du rapport Z ;
--   closing_sales_total    — chiffre d'affaires de la session, la même somme que
--                            sales_total du rapport Z ;
--   closing_order_count    — nombre de commandes vendues de la session (payées,
--                            terminées, ou en ardoise non annulée).
-- Un déclencheur refuse de les réécrire tant que la session reste clôturée.
-- get_pos_sessions_report_v5 lit ces valeurs figées.
--
-- Les sessions clôturées avant cette règle gardent NULL : rien n'a figé leurs
-- totaux au moment de leur clôture, et les recalculer aujourd'hui serait un
-- chiffre du jour présenté comme figé. Le rapport garde pour elles sa lecture
-- d'avant (rapport Z, puis calcul vivant).
--
-- close_shift_v14 et get_pos_sessions_report_v4 restent jusqu'à l'installation
-- du paquet caisse qui appelle les versions neuves ; leur retrait vit dans une
-- migration séparée. Corps repris du vivant (pg_get_functiondef) du 2026-11-19.

ALTER TABLE public.pos_sessions
  ADD COLUMN closing_payment_totals jsonb,
  ADD COLUMN closing_sales_total    numeric(15,2),
  ADD COLUMN closing_order_count    integer;

COMMENT ON COLUMN public.pos_sessions.closing_payment_totals IS
  'S3-02 — encaissements nets par moyen de paiement, figés à la clôture (close_shift_v15). NULL = clôture antérieure à la règle, ou session ouverte.';
COMMENT ON COLUMN public.pos_sessions.closing_sales_total IS
  'S3-02 — chiffre d''affaires de la session, figé à la clôture. NULL = clôture antérieure à la règle, ou session ouverte.';
COMMENT ON COLUMN public.pos_sessions.closing_order_count IS
  'S3-02 — nombre de commandes vendues de la session, figé à la clôture. NULL = clôture antérieure à la règle, ou session ouverte.';

-- Les totaux figés ne se réécrivent pas sur une session clôturée. Seule une
-- remise en open (annulation de clôture) peut les effacer.
CREATE FUNCTION public._guard_frozen_shift_totals_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'closed'
     AND (OLD.closing_payment_totals IS NOT NULL
          OR OLD.closing_sales_total IS NOT NULL
          OR OLD.closing_order_count IS NOT NULL)
     AND (NEW.closing_payment_totals IS DISTINCT FROM OLD.closing_payment_totals
          OR NEW.closing_sales_total IS DISTINCT FROM OLD.closing_sales_total
          OR NEW.closing_order_count IS DISTINCT FROM OLD.closing_order_count) THEN
    RAISE EXCEPTION 'closing_totals_frozen' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._guard_frozen_shift_totals_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._guard_frozen_shift_totals_v1() FROM anon;
REVOKE ALL ON FUNCTION public._guard_frozen_shift_totals_v1() FROM authenticated;

CREATE TRIGGER guard_frozen_shift_totals
  BEFORE UPDATE ON public.pos_sessions
  FOR EACH ROW EXECUTE FUNCTION public._guard_frozen_shift_totals_v1();

-- close_shift_v15 = close_shift_v14 + gel des totaux, entre la construction
-- de l'instantané du rapport Z et son insertion. Les totaux sont lus dans cet
-- instantané : le rapport Z et la session portent les mêmes sommes.
-- Pour S3-03 (annulation de clôture), la recherche de l'écriture d'écart
-- existante ignore une écriture contre-passée : une session rouverte puis
-- reclôturée passe sa nouvelle écriture d'écart.
CREATE FUNCTION public.close_shift_v15(p_session_id uuid, p_counted_cash numeric, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_approver_id uuid DEFAULT NULL::uuid, p_manager_pin text DEFAULT NULL::text, p_counted_qris numeric DEFAULT NULL::numeric, p_counted_card numeric DEFAULT NULL::numeric, p_denominations jsonb DEFAULT NULL::jsonb)
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
  v_unpaid_count  INT;
  v_unpaid_list   TEXT;
  v_order_count   INT;
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
  -- v14 : une commande ouverte, impayée, ni en ardoise ni en attente, ne doit
  -- pas survivre à sa caisse. Le caissier l'encaisse, la met en ardoise, la
  -- met en attente ou l'annule avant de clôturer.
  SELECT COUNT(*)::INT,
         string_agg(o.order_number, ', ' ORDER BY o.created_at)
    INTO v_unpaid_count, v_unpaid_list
    FROM orders o
   WHERE o.session_id = p_session_id
     AND o.status IN ('draft', 'pending_payment')
     AND o.outstanding_at IS NULL
     AND o.voided_at IS NULL
     AND o.is_held IS NOT TRUE
     AND o.financial_import_document_id IS NULL
     AND o.is_historical_import IS NOT TRUE;
  IF v_unpaid_count > 0 THEN
    RAISE EXCEPTION 'unpaid_orders_open'
      USING ERRCODE = 'P0001',
            DETAIL = v_unpaid_list,
            HINT = 'Pay, put on a tab, hold or void these orders before closing the shift';
  END IF;
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_cash_sales
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE op.session_id = p_session_id
     AND (o.status <> 'voided' OR o.outstanding_at IS NOT NULL)
     AND op.method = 'cash';
  -- Les voids sont déjà exclus des encaissements ; leur miroir ne se déduit pas.
  SELECT v_cash_sales - COALESCE(SUM(rp.amount), 0) INTO v_cash_sales
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
   WHERE reporting_private.refund_payment_session_v1(r) = p_session_id
     AND (NOT r.is_full_void OR o.outstanding_at IS NOT NULL)
     AND (o.status IN ('paid', 'completed') OR o.outstanding_at IS NOT NULL)
     AND rp.method = 'cash';
  v_expected := v_opening + v_cash_sales + v_in_tot - v_out_tot;
  v_variance := p_counted_cash - v_expected;
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_qris_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE op.session_id = p_session_id
     AND (o.status <> 'voided' OR o.outstanding_at IS NOT NULL)
     AND op.method IN ('qris', 'gopay', 'ovo', 'dana');
  -- Les voids sont déjà exclus des encaissements ; leur miroir ne se déduit pas.
  SELECT v_qris_expected - COALESCE(SUM(rp.amount), 0) INTO v_qris_expected
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
   WHERE reporting_private.refund_payment_session_v1(r) = p_session_id
     AND (NOT r.is_full_void OR o.outstanding_at IS NOT NULL)
     AND (o.status IN ('paid', 'completed') OR o.outstanding_at IS NOT NULL)
     AND rp.method IN ('qris', 'gopay', 'ovo', 'dana');
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_card_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE op.session_id = p_session_id
     AND (o.status <> 'voided' OR o.outstanding_at IS NOT NULL)
     AND op.method IN ('card', 'edc');
  -- Les voids sont déjà exclus des encaissements ; leur miroir ne se déduit pas.
  SELECT v_card_expected - COALESCE(SUM(rp.amount), 0) INTO v_card_expected
    FROM refund_payments rp
    JOIN refunds r ON r.id = rp.refund_id
    JOIN orders o ON o.id = r.order_id
   WHERE reporting_private.refund_payment_session_v1(r) = p_session_id
     AND (NOT r.is_full_void OR o.outstanding_at IS NOT NULL)
     AND (o.status IN ('paid', 'completed') OR o.outstanding_at IS NOT NULL)
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
    -- v15 (S3-03) : une écriture d'écart contre-passée par une annulation de
    -- clôture ne compte plus, ni la contre-passation elle-même.
    SELECT je.id INTO v_je_existing
      FROM journal_entries je
     WHERE je.reference_type = 'shift_close' AND je.reference_id = p_session_id
       AND NOT (COALESCE(je.metadata, '{}'::jsonb) ? 'reverses')
       AND NOT EXISTS (SELECT 1 FROM journal_entries rv
                        WHERE rv.reference_type = 'shift_close'
                          AND rv.metadata->>'reverses' = je.id::text)
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
  -- v15 (S3-02) : les totaux de la session sont figés ici, depuis l'instantané
  -- du rapport Z ; le nombre de commandes suit le même périmètre que sales_total.
  SELECT COUNT(*)::INT INTO v_order_count
    FROM orders o
   WHERE o.session_id = p_session_id
     AND ((o.status IN ('paid', 'completed') AND o.outstanding_at IS NULL)
          OR (o.outstanding_at IS NOT NULL AND o.status <> 'voided'));
  UPDATE pos_sessions
     SET closing_payment_totals = COALESCE(v_snapshot->'totals_by_payment_method', '{}'::jsonb),
         closing_sales_total    = COALESCE((v_snapshot->>'sales_total')::NUMERIC, 0),
         closing_order_count    = v_order_count
   WHERE id = p_session_id;
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
    'closing_sales_total', COALESCE((v_snapshot->>'sales_total')::NUMERIC, 0),
    'closing_order_count', v_order_count,
    'closing_payment_totals', COALESCE(v_snapshot->'totals_by_payment_method', '{}'::jsonb),
    'idempotent_replay', FALSE
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.close_shift_v15(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_shift_v15(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_shift_v15(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb) TO authenticated;

-- get_pos_sessions_report_v5 = get_pos_sessions_report_v4 + lecture des totaux
-- figés (chiffre d'affaires et nombre de commandes) pour une session clôturée.
-- Sans totaux figés (clôture antérieure à la règle), la lecture d'avant reste.
CREATE FUNCTION public.get_pos_sessions_report_v5(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz       TEXT;
  v_sessions JSONB;
  v_summary  JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT ps.*
      FROM reporting_private.closed_pos_sessions_v1 ps
     WHERE ((ps.opened_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  order_agg AS (
    SELECT o.session_id,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text <> 'voided' AND (o.outstanding_at IS NOT NULL OR o.status IN ('paid','completed'))), 0) AS sales_total,
           COUNT(*)              FILTER (WHERE o.status::text <> 'voided' AND (o.outstanding_at IS NOT NULL OR o.status IN ('paid','completed')))     AS order_count,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text =  'voided'), 0) AS voids_total
      FROM reporting_private.closed_pos_orders_v1 o
     WHERE o.session_id IN (SELECT id FROM scoped)
     GROUP BY o.session_id
  ),
  refund_agg AS (
    SELECT reporting_private.refund_payment_session_v1(ROW(r.*)::public.refunds) AS session_id, COALESCE(SUM(r.total), 0) AS refunds_total
      FROM reporting_private.closed_refunds_v1 r
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = r.order_id
     WHERE reporting_private.refund_payment_session_v1(ROW(r.*)::public.refunds) IN (SELECT id FROM scoped) AND (NOT r.is_full_void OR o.outstanding_at IS NOT NULL)
     GROUP BY reporting_private.refund_payment_session_v1(ROW(r.*)::public.refunds)
  ),
  session_rows AS (
    SELECT
      s.id,
      s.status::text                                       AS status,
      s.opened_by                                          AS cashier_id,
      COALESCE(uo.full_name, '—')                          AS cashier_name,
      s.closed_by                                          AS closed_by_id,
      cb.full_name                                         AS closed_by_name,
      s.opened_at,
      s.closed_at,
      s.opening_cash,
      -- v5 (S3-02) : une session clôturée lit d'abord ses totaux figés.
      CASE WHEN s.status='closed' AND fz.closing_sales_total IS NOT NULL THEN fz.closing_sales_total
           WHEN s.status='closed' AND zr.snapshot IS NOT NULL THEN coalesce((zr.snapshot->>'sales_total')::numeric,0) ELSE COALESCE(oa.sales_total,0) END AS sales_total,
      CASE WHEN s.status='closed' AND fz.closing_order_count IS NOT NULL THEN fz.closing_order_count
           ELSE COALESCE(oa.order_count, 0) END             AS order_count,
      CASE WHEN s.status='closed' AND zr.snapshot IS NOT NULL THEN coalesce((zr.snapshot->>'refunds_total')::numeric,0) ELSE COALESCE(ra.refunds_total,0) END AS refunds_total,
      CASE WHEN s.status='closed' AND zr.snapshot IS NOT NULL THEN coalesce((zr.snapshot->>'voids_total')::numeric,0) ELSE COALESCE(oa.voids_total,0) END AS voids_total,
      COALESCE(CASE WHEN s.status='closed' THEN (zr.snapshot->>'receipts_total')::numeric END,
        (SELECT coalesce(sum(op.amount),0) FROM reporting_private.closed_order_payments_v1 op JOIN reporting_private.closed_pos_orders_v1 po ON po.id=op.order_id
         WHERE op.session_id=s.id AND (po.status<>'voided' OR po.outstanding_at IS NOT NULL))) AS receipts_total,
      COALESCE((sc.metadata->>'expected_cash')::numeric, s.expected_cash) AS cash_expected,
      COALESCE((sc.metadata->>'counted_cash')::numeric,  s.closing_cash)  AS cash_counted,
      COALESCE((sc.metadata->>'variance')::numeric,      s.variance_total) AS cash_variance,
      (sc.metadata->>'expected_qris')::numeric            AS qris_expected,
      COALESCE((sc.metadata->>'counted_qris')::numeric, s.counted_qris) AS qris_counted,
      (sc.metadata->>'variance_qris')::numeric            AS qris_variance,
      (sc.metadata->>'expected_card')::numeric            AS card_expected,
      COALESCE((sc.metadata->>'counted_card')::numeric, s.counted_card) AS card_counted,
      (sc.metadata->>'variance_card')::numeric            AS card_variance,
      s.opening_notes,
      s.closing_notes,
      (s.variance_approved_by IS NOT NULL)                 AS variance_approved
    FROM scoped s
    JOIN user_profiles uo ON uo.id = s.opened_by
    LEFT JOIN user_profiles cb ON cb.id = s.closed_by
    LEFT JOIN pos_sessions fz ON fz.id = s.id
    LEFT JOIN order_agg  oa ON oa.session_id = s.id
    LEFT JOIN LATERAL (SELECT z.snapshot FROM z_reports z WHERE z.shift_id=s.id LIMIT 1) zr ON true
    LEFT JOIN refund_agg ra ON ra.session_id = s.id
    LEFT JOIN LATERAL (
      SELECT al.metadata
        FROM audit_logs al
       WHERE al.action = 'shift.close'
         AND al.entity_type = 'pos_sessions'
         AND al.entity_id = s.id
       ORDER BY al.created_at DESC
       LIMIT 1
    ) sc ON TRUE
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'session_id',      sr.id,
      'status',          sr.status,
      'cashier_id',      sr.cashier_id,
      'cashier_name',    sr.cashier_name,
      'closed_by_id',    sr.closed_by_id,
      'closed_by_name',  sr.closed_by_name,
      'opened_at',       sr.opened_at,
      'closed_at',       sr.closed_at,
      'opening_cash',    sr.opening_cash,
      'sales_total',     sr.sales_total,
      'receipts_total',  sr.receipts_total,
      'order_count',     sr.order_count,
      'refunds_total',   sr.refunds_total,
      'voids_total',     sr.voids_total,
      'cash', jsonb_build_object(
        'expected', sr.cash_expected,
        'counted',  sr.cash_counted,
        'variance', CASE WHEN sr.status = 'open' THEN NULL ELSE sr.cash_variance END
      ),
      'qris', jsonb_build_object(
        'expected', sr.qris_expected,
        'counted',  sr.qris_counted,
        'variance', CASE WHEN sr.qris_counted IS NULL THEN NULL ELSE sr.qris_variance END
      ),
      'card', jsonb_build_object(
        'expected', sr.card_expected,
        'counted',  sr.card_counted,
        'variance', CASE WHEN sr.card_counted IS NULL THEN NULL ELSE sr.card_variance END
      ),
      'opening_notes',     sr.opening_notes,
      'closing_notes',     sr.closing_notes,
      'variance_approved', sr.variance_approved
    ) ORDER BY sr.opened_at DESC
  )
  INTO v_sessions
  FROM session_rows sr;

  WITH scoped AS (
    SELECT ps.id, ps.status::text AS status
      FROM reporting_private.closed_pos_sessions_v1 ps
     WHERE ((ps.opened_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  order_agg AS (
    SELECT o.session_id,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text <> 'voided' AND (o.outstanding_at IS NOT NULL OR o.status IN ('paid','completed'))), 0) AS sales_total,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text =  'voided'), 0) AS voids_total
      FROM reporting_private.closed_pos_orders_v1 o
     WHERE o.session_id IN (SELECT id FROM scoped)
     GROUP BY o.session_id
  ),
  cash_close AS (
    SELECT ps.id,
           COALESCE((sc.metadata->>'variance')::numeric, ps.variance_total) AS cash_variance
      FROM reporting_private.closed_pos_sessions_v1 ps
      LEFT JOIN LATERAL (
        SELECT al.metadata FROM audit_logs al
         WHERE al.action = 'shift.close' AND al.entity_type = 'pos_sessions' AND al.entity_id = ps.id
         ORDER BY al.created_at DESC LIMIT 1
      ) sc ON TRUE
     WHERE ps.id IN (SELECT id FROM scoped WHERE status = 'closed')
  )
  SELECT jsonb_build_object(
    'total_sessions',       (SELECT COUNT(*) FROM scoped),
    'open_count',           (SELECT COUNT(*) FROM scoped WHERE status = 'open'),
    'closed_count',         (SELECT COUNT(*) FROM scoped WHERE status = 'closed'),
    'sales_total',          (SELECT coalesce(sum((e->>'sales_total')::numeric),0) FROM jsonb_array_elements(coalesce(v_sessions,'[]'::jsonb)) e),
    'receipts_total',       (SELECT coalesce(sum((e->>'receipts_total')::numeric),0) FROM jsonb_array_elements(coalesce(v_sessions,'[]'::jsonb)) e),
    'voids_total',          (SELECT coalesce(sum((e->>'voids_total')::numeric),0) FROM jsonb_array_elements(coalesce(v_sessions,'[]'::jsonb)) e),
    'cash_variance_total',  (SELECT COALESCE(SUM(cash_variance), 0) FROM cash_close),
    'cash_short_count',     (SELECT COUNT(*) FROM cash_close WHERE cash_variance < 0),
    'cash_over_count',      (SELECT COUNT(*) FROM cash_close WHERE cash_variance > 0)
  ) INTO v_summary;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'summary',      v_summary,
    'sessions',     COALESCE(v_sessions, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_sessions_report_v5(date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pos_sessions_report_v5(date,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_sessions_report_v5(date,date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
