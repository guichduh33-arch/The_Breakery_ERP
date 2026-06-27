-- 20260710000052_gate_financial_report_rpcs.sql
-- Session 50 / W1.2 — Gate 5 financial/report RPCs with has_permission.
--
-- RPCs bumped : v1 → v2 for all 5. DROP v1 in same migration (monotone versioning).
-- SECURITY DEFINER replaces SECURITY INVOKER (permission check uses auth.uid()).
-- get_sales_by_hour_v2 converted from LANGUAGE sql to plpgsql to support IF gate.
--
-- Permission codes (all pre-existing — verified in migrations):
--   get_general_ledger_v2  → accounting.gl.read   (seeded 20260603000026)
--   get_trial_balance_v2   → accounting.tb.read   (seeded 20260603000026)
--   get_profit_loss_v2     → reports.financial.read (seeded 20260517000076)
--   get_balance_sheet_v2   → reports.financial.read (seeded 20260517000076)
--   get_sales_by_hour_v2   → reports.read          (seeded 20260517000030)
--
-- Call-sites to update (in same PR, done separately):
--   apps/backoffice/src/features/accounting/hooks/useGeneralLedger.ts
--   apps/backoffice/src/features/accounting/hooks/useTrialBalance.ts
--   apps/backoffice/src/features/reports/hooks/useProfitLoss.ts
--   apps/backoffice/src/features/reports/hooks/useBalanceSheet.ts
--   apps/backoffice/src/features/reports/hooks/useSalesByHour.ts
--
-- DEV-S50-W1.2

-- ============================================================
-- 1. get_general_ledger_v2
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_general_ledger_v2(
  p_account_id  UUID,
  p_date_start  DATE,
  p_date_end    DATE,
  p_limit       INT DEFAULT 50,
  p_cursor      JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lines           JSONB;
  v_account         RECORD;
  v_opening_balance NUMERIC(14,2) := 0;
  v_total_debit     NUMERIC(14,2) := 0;
  v_total_credit    NUMERIC(14,2) := 0;
  v_next_cursor     JSONB := NULL;
  v_cursor_date     DATE;
  v_cursor_id       UUID;
  v_count           INT;
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.gl.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.gl.read'
      USING ERRCODE = '42501';
  END IF;

  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, code, name, account_class, balance_type, is_active
    INTO v_account
    FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT
    COALESCE(SUM(
      CASE v_account.balance_type
        WHEN 'debit'  THEN (jel.debit - jel.credit)
        ELSE              (jel.credit - jel.debit)
      END
    ), 0)
  INTO v_opening_balance
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id
    AND je.status IN ('posted','locked')
    AND je.entry_date < p_date_start
    AND NOT (
      je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
    );

  IF p_cursor IS NOT NULL THEN
    v_cursor_date := (p_cursor->>'last_date')::DATE;
    v_cursor_id   := (p_cursor->>'last_id')::UUID;
  END IF;

  WITH paged AS (
    SELECT
      je.id           AS je_id,
      je.entry_number,
      je.entry_date,
      je.description  AS je_description,
      je.reference_type,
      je.reference_id,
      jel.debit,
      jel.credit,
      jel.description AS line_description
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
      AND (
        v_cursor_date IS NULL OR
        (je.entry_date, je.id) > (v_cursor_date, v_cursor_id)
      )
    ORDER BY je.entry_date ASC, je.id ASC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'je_id',            je_id,
        'entry_number',     entry_number,
        'entry_date',       entry_date,
        'description',      je_description,
        'reference_type',   reference_type,
        'reference_id',     reference_id,
        'debit',            debit,
        'credit',           credit,
        'line_description', line_description
      )
      ORDER BY entry_date ASC, je_id ASC
    ) FILTER (WHERE TRUE), '[]'::JSONB),
    COUNT(*)::INT
  INTO v_lines, v_count
  FROM (SELECT * FROM paged LIMIT p_limit) windowed;

  IF v_count >= p_limit AND EXISTS (
    SELECT 1 FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
      AND (
        v_cursor_date IS NULL OR
        (je.entry_date, je.id) > (v_cursor_date, v_cursor_id)
      )
    OFFSET p_limit LIMIT 1
  ) THEN
    SELECT jsonb_build_object('last_date', entry_date, 'last_id', je_id)
      INTO v_next_cursor
      FROM jsonb_to_recordset(v_lines) AS x(je_id UUID, entry_date DATE)
      ORDER BY entry_date DESC, je_id DESC
      LIMIT 1;
  END IF;

  SELECT
    COALESCE(SUM(jel.debit),  0),
    COALESCE(SUM(jel.credit), 0)
  INTO v_total_debit, v_total_credit
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id
    AND je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND NOT (
      je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
    );

  RETURN jsonb_build_object(
    'account', jsonb_build_object(
      'id',            v_account.id,
      'code',          v_account.code,
      'name',          v_account.name,
      'account_class', v_account.account_class,
      'balance_type',  v_account.balance_type,
      'is_active',     v_account.is_active
    ),
    'period',          jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'opening_balance', v_opening_balance,
    'total_debit',     v_total_debit,
    'total_credit',    v_total_credit,
    'lines',           v_lines,
    'next_cursor',     v_next_cursor
  );
END;
$$;

DROP FUNCTION IF EXISTS public.get_general_ledger_v1(UUID, DATE, DATE, INT, JSONB);

REVOKE EXECUTE ON FUNCTION public.get_general_ledger_v2(UUID, DATE, DATE, INT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_general_ledger_v2(UUID, DATE, DATE, INT, JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_general_ledger_v2(UUID, DATE, DATE, INT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.get_general_ledger_v2(UUID, DATE, DATE, INT, JSONB) IS
  'S50 W1.2 — General Ledger drilldown. Gate: accounting.gl.read (was INVOKER → now DEFINER+gate). Logic identical to v1 (S26+S32). Caller must hold accounting.gl.read.';

-- ============================================================
-- 2. get_trial_balance_v2
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_trial_balance_v2(
  p_date_start DATE,
  p_date_end   DATE
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lines        JSONB;
  v_total_debit  NUMERIC(14,2);
  v_total_credit NUMERIC(14,2);
  v_balanced     BOOLEAN;
  v_delta        NUMERIC(14,2);
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.tb.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.tb.read'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  WITH agg AS (
    SELECT
      a.id,
      a.code,
      a.name,
      a.account_class,
      a.balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS total_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS total_credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries     je  ON je.id = jel.journal_entry_id
      AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
    WHERE a.is_active = TRUE
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'account_id',    id,
        'code',          code,
        'name',          name,
        'account_class', account_class,
        'balance_type',  balance_type,
        'total_debit',   total_debit,
        'total_credit',  total_credit,
        'balance',
          CASE balance_type
            WHEN 'debit'  THEN (total_debit  - total_credit)
            ELSE              (total_credit - total_debit)
          END
      )
      ORDER BY code
    ) FILTER (WHERE total_debit <> 0 OR total_credit <> 0), '[]'::JSONB),
    COALESCE(SUM(total_debit),  0),
    COALESCE(SUM(total_credit), 0)
  INTO v_lines, v_total_debit, v_total_credit
  FROM agg;

  v_delta    := (v_total_debit - v_total_credit)::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;

  RETURN jsonb_build_object(
    'period',       jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'lines',        v_lines,
    'total_debit',  v_total_debit,
    'total_credit', v_total_credit,
    'balanced',     v_balanced,
    'delta',        v_delta
  );
END;
$$;

DROP FUNCTION IF EXISTS public.get_trial_balance_v1(DATE, DATE);

REVOKE EXECUTE ON FUNCTION public.get_trial_balance_v2(DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_trial_balance_v2(DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_trial_balance_v2(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_trial_balance_v2(DATE, DATE) IS
  'S50 W1.2 — Trial Balance. Gate: accounting.tb.read. Logic identical to v1 (S26). Dedupe sale_void+refund preserved.';

-- ============================================================
-- 3. get_profit_loss_v2
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_profit_loss_v2(
  p_date_start DATE,
  p_date_end   DATE,
  p_section_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revenue        NUMERIC(14,2) := 0;
  v_revenue_sales  NUMERIC(14,2) := 0;
  v_revenue_disc   NUMERIC(14,2) := 0;
  v_revenue_adj    NUMERIC(14,2) := 0;
  v_cogs           NUMERIC(14,2) := 0;
  v_cogs_prod      NUMERIC(14,2) := 0;
  v_cogs_waste     NUMERIC(14,2) := 0;
  v_cogs_other     NUMERIC(14,2) := 0;
  v_opex           NUMERIC(14,2) := 0;
  v_opex_salary    NUMERIC(14,2) := 0;
  v_opex_rent      NUMERIC(14,2) := 0;
  v_opex_util      NUMERIC(14,2) := 0;
  v_opex_supplies  NUMERIC(14,2) := 0;
  v_opex_marketing NUMERIC(14,2) := 0;
  v_opex_maint     NUMERIC(14,2) := 0;
  v_opex_other     NUMERIC(14,2) := 0;
  v_lines          JSONB         := '[]'::JSONB;
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_profit_loss_v2: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_profit_loss_v2: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  WITH agg AS (
    SELECT
      a.id            AS account_id,
      a.code          AS code,
      a.name          AS name,
      a.account_class AS account_class,
      a.balance_type  AS balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS total_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a         ON a.id = jel.account_id
    WHERE je.status IN ('posted', 'locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND a.account_class IN (4, 5, 6)
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '41%'  THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code IN ('4190','4900') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '45%'  THEN (total_credit - total_debit) END), 0)
      + COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '49%' AND code NOT IN ('4900','4190') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '51%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code NOT LIKE '51%' AND code NOT LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6111' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6112' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6113' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6114' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6115' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6116' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code NOT IN ('6111','6112','6113','6114','6115','6116') THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 THEN (total_debit - total_credit) END), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'account_id',    account_id,
          'code',          code,
          'name',          name,
          'debit',         total_debit,
          'credit',        total_credit,
          'balance',
            CASE
              WHEN balance_type = 'debit'  THEN (total_debit  - total_credit)
              ELSE                              (total_credit - total_debit)
            END,
          'account_class', account_class
        )
        ORDER BY code
      ) FILTER (WHERE total_debit <> 0 OR total_credit <> 0),
      '[]'::JSONB
    )
  INTO
    v_revenue_sales, v_revenue_disc, v_revenue_adj, v_revenue,
    v_cogs_prod, v_cogs_waste, v_cogs_other, v_cogs,
    v_opex_salary, v_opex_rent, v_opex_util, v_opex_supplies,
    v_opex_marketing, v_opex_maint, v_opex_other, v_opex,
    v_lines
  FROM agg;

  RETURN jsonb_build_object(
    'revenue', jsonb_build_object(
      'sales',       v_revenue_sales,
      'discounts',   v_revenue_disc,
      'adjustments', v_revenue_adj,
      'total',       v_revenue
    ),
    'cogs', jsonb_build_object(
      'production', v_cogs_prod,
      'waste',      v_cogs_waste,
      'other',      v_cogs_other,
      'total',      v_cogs
    ),
    'gross_profit',    (v_revenue - v_cogs)::NUMERIC(14,2),
    'opex', jsonb_build_object(
      'salary',      v_opex_salary,
      'rent',        v_opex_rent,
      'utilities',   v_opex_util,
      'supplies',    v_opex_supplies,
      'marketing',   v_opex_marketing,
      'maintenance', v_opex_maint,
      'other',       v_opex_other,
      'total',       v_opex
    ),
    'operating_profit', (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'net_profit',       (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'lines',  v_lines,
    'period', jsonb_build_object(
      'start',      p_date_start,
      'end',        p_date_end,
      'section_id', p_section_id
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS public.get_profit_loss_v1(DATE, DATE, UUID);

REVOKE EXECUTE ON FUNCTION public.get_profit_loss_v2(DATE, DATE, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_profit_loss_v2(DATE, DATE, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_profit_loss_v2(DATE, DATE, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_profit_loss_v2(DATE, DATE, UUID) IS
  'S50 W1.2 — P&L report. Gate: reports.financial.read. Logic identical to v1 (S32 with account_id in lines). Dedupe sale_void+refund preserved.';

-- ============================================================
-- 4. get_balance_sheet_v2
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_balance_sheet_v2(
  p_as_of_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_assets_cash    NUMERIC(14,2) := 0;
  v_assets_ar      NUMERIC(14,2) := 0;
  v_assets_inv     NUMERIC(14,2) := 0;
  v_assets_other   NUMERIC(14,2) := 0;
  v_assets_current NUMERIC(14,2) := 0;
  v_assets_fixed   NUMERIC(14,2) := 0;
  v_assets_total   NUMERIC(14,2) := 0;
  v_liab_ap        NUMERIC(14,2) := 0;
  v_liab_tax       NUMERIC(14,2) := 0;
  v_liab_loyalty   NUMERIC(14,2) := 0;
  v_liab_other     NUMERIC(14,2) := 0;
  v_liab_current   NUMERIC(14,2) := 0;
  v_liab_long      NUMERIC(14,2) := 0;
  v_liab_total     NUMERIC(14,2) := 0;
  v_eq_capital     NUMERIC(14,2) := 0;
  v_eq_retained    NUMERIC(14,2) := 0;
  v_eq_other       NUMERIC(14,2) := 0;
  v_eq_total       NUMERIC(14,2) := 0;
  v_cye_revenue    NUMERIC(14,2) := 0;
  v_cye_cogs       NUMERIC(14,2) := 0;
  v_cye_opex       NUMERIC(14,2) := 0;
  v_cye            NUMERIC(14,2) := 0;
  v_ytd_start      DATE;
  v_delta          NUMERIC(14,2) := 0;
  v_balanced       BOOLEAN       := FALSE;
  v_lines          JSONB         := '[]'::JSONB;
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read'
      USING ERRCODE = '42501';
  END IF;

  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'get_balance_sheet_v2: p_as_of_date is required';
  END IF;

  v_ytd_start := date_trunc('year', p_as_of_date::TIMESTAMP)::DATE;

  WITH agg AS (
    SELECT
      a.id            AS account_id,
      a.code,
      a.name,
      a.account_class,
      a.balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS d,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS c
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a         ON a.id = jel.account_id
    WHERE je.status IN ('posted','locked')
      AND je.entry_date <= p_as_of_date
      AND a.account_class IN (1, 2, 3)
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '111%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '113%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '114%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '115%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2141') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2110','2142','2143') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code = '2210' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code NOT IN ('2141','2110','2142','2143','2210') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code = '3100' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code LIKE '32%' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code NOT IN ('3100','3300') AND code NOT LIKE '32%' THEN (c - d) END), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'account_id',    account_id,
          'code',          code,
          'name',          name,
          'debit',         d,
          'credit',        c,
          'balance',
            CASE
              WHEN balance_type = 'debit'  THEN (d - c)
              ELSE                              (c - d)
            END,
          'account_class', account_class
        )
        ORDER BY code
      ) FILTER (WHERE d <> 0 OR c <> 0),
      '[]'::JSONB
    )
  INTO
    v_assets_cash, v_assets_ar, v_assets_inv, v_assets_other,
    v_liab_ap, v_liab_tax, v_liab_loyalty, v_liab_other,
    v_eq_capital, v_eq_retained, v_eq_other,
    v_lines
  FROM agg;

  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0)
  INTO v_cye_revenue, v_cye_cogs, v_cye_opex
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN v_ytd_start AND p_as_of_date
    AND a.account_class IN (4, 5, 6)
    AND NOT (
      je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
    );

  v_cye            := (v_cye_revenue - v_cye_cogs - v_cye_opex)::NUMERIC(14,2);
  v_assets_current := (v_assets_cash + v_assets_ar + v_assets_inv + v_assets_other)::NUMERIC(14,2);
  v_assets_total   := (v_assets_current + v_assets_fixed)::NUMERIC(14,2);
  v_liab_current   := (v_liab_ap + v_liab_tax + v_liab_loyalty + v_liab_other)::NUMERIC(14,2);
  v_liab_total     := (v_liab_current + v_liab_long)::NUMERIC(14,2);
  v_eq_total       := (v_eq_capital + v_eq_retained + v_eq_other + v_cye)::NUMERIC(14,2);
  v_delta          := (v_assets_total - (v_liab_total + v_eq_total))::NUMERIC(14,2);
  v_balanced       := ABS(v_delta) < 0.01;

  RETURN jsonb_build_object(
    'assets', jsonb_build_object(
      'current', jsonb_build_object(
        'cash', v_assets_cash, 'ar', v_assets_ar,
        'inventory', v_assets_inv, 'other', v_assets_other,
        'total', v_assets_current
      ),
      'fixed', jsonb_build_object('total', v_assets_fixed),
      'total', v_assets_total
    ),
    'liabilities', jsonb_build_object(
      'current', jsonb_build_object(
        'ap', v_liab_ap, 'tax_payable', v_liab_tax,
        'loyalty', v_liab_loyalty, 'other', v_liab_other,
        'total', v_liab_current
      ),
      'long_term', jsonb_build_object('total', v_liab_long),
      'total', v_liab_total
    ),
    'equity', jsonb_build_object(
      'share_capital',         v_eq_capital,
      'retained_earnings',     v_eq_retained,
      'current_year_earnings', v_cye,
      'other',                 v_eq_other,
      'total',                 v_eq_total
    ),
    'balanced', v_balanced,
    'delta',    v_delta,
    'as_of',    p_as_of_date,
    'lines',    v_lines
  );
END;
$$;

DROP FUNCTION IF EXISTS public.get_balance_sheet_v1(DATE);

REVOKE EXECUTE ON FUNCTION public.get_balance_sheet_v2(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_balance_sheet_v2(DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_balance_sheet_v2(DATE) TO authenticated;

COMMENT ON FUNCTION public.get_balance_sheet_v2(DATE) IS
  'S50 W1.2 — Balance Sheet. Gate: reports.financial.read. Logic identical to v1 (S32 with lines array + account_id). Dedupe sale_void+refund preserved.';

-- ============================================================
-- 5. get_sales_by_hour_v2 (LANGUAGE sql → plpgsql for gate)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_sales_by_hour_v2(
  p_date DATE
)
RETURNS TABLE (
  hour        INT,
  total       DECIMAL(14,2),
  order_count INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  ),
  bucketed AS (
    SELECT
      EXTRACT(HOUR FROM (o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::INT AS hour,
      o.total
    FROM orders o
    WHERE o.status = 'paid'
      AND o.paid_at IS NOT NULL
      AND o.voided_at IS NULL
      AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date = p_date
  ),
  rolled AS (
    SELECT b.hour,
           SUM(b.total)::DECIMAL(14,2) AS total,
           COUNT(*)::INT               AS order_count
      FROM bucketed b
     GROUP BY b.hour
  ),
  hours AS (SELECT generate_series(0, 23) AS hour)
  SELECT
    hours.hour,
    COALESCE(rolled.total,       0::DECIMAL(14,2)) AS total,
    COALESCE(rolled.order_count, 0)                AS order_count
  FROM hours
  LEFT JOIN rolled USING (hour)
  ORDER BY hours.hour;
END;
$$;

DROP FUNCTION IF EXISTS public.get_sales_by_hour_v1(DATE);

REVOKE EXECUTE ON FUNCTION public.get_sales_by_hour_v2(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_hour_v2(DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_hour_v2(DATE) TO authenticated;

COMMENT ON FUNCTION public.get_sales_by_hour_v2(DATE) IS
  'S50 W1.2 — Sales by hour (24 rows). Gate: reports.read. Converted from LANGUAGE sql to plpgsql to support permission gate. Logic identical to v1 (S13 Phase 2.B). Bucketed in business_config.timezone.';

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
