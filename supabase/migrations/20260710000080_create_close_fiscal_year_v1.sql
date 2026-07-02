-- S54 P1.3 · T6 — clôture annuelle : carry-forward P&L (classes 4/5/6) → 3200.
-- JE 'year_close' datée 31/12 (insérée SANS check_fiscal_period_open — écriture
-- de clôture dans une période fermée par design). Seed 12 périodes N+1 (garantit
-- le fail-closed _077 sans bombe à retardement). 3300 CYE non touché (dérivé live,
-- retombe à 0 une fois les 4/5/6 zérotés — intention du seed _019 respectée).
-- Cloud appliqué en 2 apply_migration : create_close_fiscal_year_v1 +
-- extend_je_reference_type_year_close (contrainte découverte à l'exécution).

-- 1. reference_type 'year_close' admis sur journal_entries
ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_reference_type_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_reference_type_check
CHECK (reference_type IS NULL OR reference_type = ANY (ARRAY[
  'sale','sale_void','sale_refund','purchase','purchase_return','purchase_payment',
  'expense','expense_payment','shift_close','adjustment','waste','opname','production',
  'transfer','manual','pos_outstanding','pos_outstanding_payment','stock_movement',
  'void','refund','cash_movement','b2b_order','b2b_payment','b2b_adjustment',
  'b2b_order_cancel','year_close']));

-- 2. RPC
CREATE OR REPLACE FUNCTION public.close_fiscal_year_v1(
  p_fiscal_year INT,
  p_manager_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
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
                  AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id))
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
                    AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id))
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
         'Seeded by close_fiscal_year_v1(' || p_fiscal_year || ')'
    FROM generate_series(make_date(p_fiscal_year + 1, 1, 1),
                         make_date(p_fiscal_year + 1, 12, 1),
                         INTERVAL '1 month') AS d
  ON CONFLICT (period_end) DO NOTHING;
  GET DIAGNOSTICS v_seeded = ROW_COUNT;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
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
$$;

REVOKE ALL ON FUNCTION public.close_fiscal_year_v1(INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_fiscal_year_v1(INT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.close_fiscal_year_v1(INT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.close_fiscal_year_v1(INT, TEXT) IS
  'S54 T6 : clôture annuelle. Préconditions 12 périodes closed/locked (FOR UPDATE) + '
  'pas de year_close existante. JE year_close 31/12 zérotant classes 4/5/6 (dédup '
  'canonique) avec contrepartie 3200. Seed 12 périodes N+1. Gate accounting.year.close '
  '+ _verify_pin_with_lockout. Audit accounting.year.closed.';
