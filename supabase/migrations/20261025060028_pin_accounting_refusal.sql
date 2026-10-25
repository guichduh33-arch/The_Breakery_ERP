-- Corps live conservés ; le refus PIN retourne sans annuler le compteur de sécurité.
CREATE OR REPLACE FUNCTION public.close_fiscal_period_v2(p_period_id uuid, p_manager_pin text, p_lock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_period  RECORD;
  v_new_status TEXT;
BEGIN
  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'period_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT public.has_permission(v_uid, 'accounting.period.close') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'period_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_period.status = 'locked' THEN
    RAISE EXCEPTION 'period_already_locked' USING ERRCODE = 'P0003';
  END IF;
  IF v_period.status = 'closed' AND NOT p_lock THEN
    RAISE EXCEPTION 'period_already_closed' USING ERRCODE = 'P0003';
  END IF;

  v_new_status := CASE WHEN p_lock THEN 'locked' ELSE 'closed' END;

  IF p_lock THEN
    UPDATE fiscal_periods
      SET status = v_new_status,
          locked_by = v_profile,
          locked_at = now()
      WHERE id = p_period_id;
  ELSE
    UPDATE fiscal_periods
      SET status = v_new_status,
          closed_by = v_profile,
          closed_at = now()
      WHERE id = p_period_id;
  END IF;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'accounting.period.closed',
    'fiscal_periods',
    p_period_id,
    jsonb_build_object(
      'period_start', v_period.period_start,
      'period_end',   v_period.period_end,
      'old_status',   v_period.status,
      'new_status',   v_new_status
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'period_id',    p_period_id,
    'period_start', v_period.period_start,
    'period_end',   v_period.period_end,
    'new_status',   v_new_status,
    'closed_at',    now()
  );
END;
$function$;
DROP FUNCTION public.close_fiscal_period_v1(uuid,text,boolean);
REVOKE ALL ON FUNCTION public.close_fiscal_period_v2(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_fiscal_period_v2(uuid,text,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_manual_je_v2(p_description text, p_entry_date date, p_lines jsonb, p_manager_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  PERFORM check_fiscal_period_open(p_entry_date);

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
      RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_acc_row.is_active THEN
      RAISE EXCEPTION 'account_inactive' USING ERRCODE = 'P0003';
    END IF;
    IF NOT v_acc_row.is_postable THEN
      RAISE EXCEPTION 'account_not_postable' USING ERRCODE = 'P0003';
    END IF;

    v_total_debit  := v_total_debit  + v_dr;
    v_total_credit := v_total_credit + v_cr;
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) >= 0.01 THEN
    RAISE EXCEPTION 'je_unbalanced' USING ERRCODE = 'P0001';
  END IF;

  v_entry_no := next_journal_entry_number(p_entry_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, p_entry_date,
    p_description,
    'manual',
    NULL,
    'posted',
    v_total_debit, v_total_credit,
    v_profile
  ) RETURNING id INTO v_je_id;

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

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
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
$function$;
DROP FUNCTION public.create_manual_je_v1(text,date,jsonb,text);
REVOKE ALL ON FUNCTION public.create_manual_je_v2(text,date,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_je_v2(text,date,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_fiscal_year_v3(p_fiscal_year integer, p_manager_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        UUID := auth.uid();
  v_profile    UUID;
  v_start      DATE;
  v_end        DATE;
  v_cnt        INT;
  v_not_closed INT;
  v_re_id      UUID;
  v_line_cnt   INT;
  v_dr_total   NUMERIC(14,2);
  v_cr_total   NUMERIC(14,2);
  v_net        NUMERIC(14,2);
  v_je_id      UUID;
  v_entry_no   TEXT;
  v_seeded     INT := 0;
BEGIN
  IF p_fiscal_year IS NULL OR p_fiscal_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'fiscal_year_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.has_permission(v_uid, 'accounting.year.close') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  v_start := make_date(p_fiscal_year, 1, 1);
  v_end   := make_date(p_fiscal_year, 12, 31);

  -- Préconditions : 12 périodes toutes closed/locked (FOR UPDATE sérialise)
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status NOT IN ('closed','locked'))
    INTO v_cnt, v_not_closed
    FROM (SELECT status FROM fiscal_periods
            WHERE period_start >= v_start AND period_end <= v_end
            FOR UPDATE) p;
  IF v_cnt < 12 THEN
    RAISE EXCEPTION 'fiscal_year_periods_missing: % of 12 seeded for %', v_cnt, p_fiscal_year
      USING ERRCODE = 'P0002';
  END IF;
  IF v_not_closed > 0 THEN
    RAISE EXCEPTION 'fiscal_year_periods_open: % period(s) of % not closed/locked',
      v_not_closed, p_fiscal_year USING ERRCODE = 'P0003';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries
              WHERE reference_type = 'year_close'
                AND entry_date = v_end
                AND status IN ('posted','locked')) THEN
    RAISE EXCEPTION 'year_already_closed: %', p_fiscal_year USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_re_id FROM accounts WHERE code = '3200' AND is_active;
  IF v_re_id IS NULL THEN
    RAISE EXCEPTION 'retained_earnings_account_missing: 3200' USING ERRCODE = 'P0002';
  END IF;

  -- Agrégat P&L de l'exercice (dédup canonique sale_void+refund)
  SELECT COUNT(*),
         COALESCE(SUM(CASE WHEN net_credit > 0 THEN net_credit END), 0),
         COALESCE(SUM(CASE WHEN net_credit < 0 THEN -net_credit END), 0),
         COALESCE(SUM(net_credit), 0)
    INTO v_line_cnt, v_dr_total, v_cr_total, v_net
    FROM (
      SELECT (SUM(COALESCE(jel.credit,0)) - SUM(COALESCE(jel.debit,0)))::NUMERIC(14,2) AS net_credit
        FROM accounts a
        JOIN journal_entry_lines jel ON jel.account_id = a.id
        JOIN journal_entries je      ON je.id = jel.journal_entry_id
       WHERE a.account_class IN (4,5,6)
         AND je.status IN ('posted','locked')
         AND je.entry_date BETWEEN v_start AND v_end
         AND je.reference_type IS DISTINCT FROM 'year_close'
         AND NOT (je.reference_type = 'sale_void'
                  AND EXISTS (SELECT 1 FROM journal_entries jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
       GROUP BY a.id
      HAVING (SUM(COALESCE(jel.credit,0)) - SUM(COALESCE(jel.debit,0))) <> 0
    ) nets;

  IF v_line_cnt > 0 THEN
    v_entry_no := next_journal_entry_number(v_end);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, v_end,
      'Year-end close ' || p_fiscal_year || ' — P&L carry-forward to 3200 Retained Earnings',
      'year_close', NULL, 'posted',
      v_dr_total + CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
      v_cr_total + CASE WHEN v_net > 0 THEN  v_net ELSE 0 END,
      v_profile
    ) RETURNING id INTO v_je_id;

    -- Lignes de zérotage 4/5/6 (même agrégat que ci-dessus, JE de clôture exclue)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    SELECT v_je_id, nets.account_id,
           CASE WHEN nets.net_credit > 0 THEN nets.net_credit ELSE 0 END,
           CASE WHEN nets.net_credit < 0 THEN -nets.net_credit ELSE 0 END,
           'Year-end close ' || p_fiscal_year
      FROM (
        SELECT a.id AS account_id,
               (SUM(COALESCE(jel.credit,0)) - SUM(COALESCE(jel.debit,0)))::NUMERIC(14,2) AS net_credit
          FROM accounts a
          JOIN journal_entry_lines jel ON jel.account_id = a.id
          JOIN journal_entries je      ON je.id = jel.journal_entry_id
         WHERE a.account_class IN (4,5,6)
           AND je.status IN ('posted','locked')
           AND je.entry_date BETWEEN v_start AND v_end
           AND je.reference_type IS DISTINCT FROM 'year_close'
           AND je.id <> v_je_id
           AND NOT (je.reference_type = 'sale_void'
                    AND EXISTS (SELECT 1 FROM journal_entries jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
         GROUP BY a.id
        HAVING (SUM(COALESCE(jel.credit,0)) - SUM(COALESCE(jel.debit,0))) <> 0
      ) nets;

    IF v_net <> 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_je_id, v_re_id,
              CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
              CASE WHEN v_net > 0 THEN  v_net ELSE 0 END,
              'Net result ' || p_fiscal_year || ' → Retained Earnings');
    END IF;
  END IF;

  -- Seed N+1 (rend le fail-closed _077 sûr dans la durée)
  INSERT INTO fiscal_periods (period_start, period_end, status, notes)
  SELECT date_trunc('month', d)::DATE,
         (date_trunc('month', d) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
         'open',
         'Seeded by close_fiscal_year_v3(' || p_fiscal_year || ')'
    FROM generate_series(make_date(p_fiscal_year + 1, 1, 1),
                         make_date(p_fiscal_year + 1, 12, 1),
                         INTERVAL '1 month') AS d
  ON CONFLICT (period_end) DO NOTHING;
  GET DIAGNOSTICS v_seeded = ROW_COUNT;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'accounting.year.closed', 'journal_entries', v_je_id,
    jsonb_build_object(
      'fiscal_year',  p_fiscal_year,
      'net_result',   v_net,
      'line_count',   v_line_cnt,
      'entry_number', v_entry_no,
      'periods_seeded_next_year', v_seeded
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'fiscal_year',  p_fiscal_year,
    'je_id',        v_je_id,
    'entry_number', v_entry_no,
    'net_result',   v_net,
    'line_count',   v_line_cnt,
    'retained_earnings_account', '3200',
    'periods_seeded_next_year',  v_seeded
  );
END;
$function$;
DROP FUNCTION public.close_fiscal_year_v2(integer,text);
REVOKE ALL ON FUNCTION public.close_fiscal_year_v3(integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year_v3(integer,text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
