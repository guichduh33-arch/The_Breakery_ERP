-- S54 P1.3 · T6 (D3) — la JE year_close zérote les classes 4/5/6 au 31/12 : sans
-- exclusion, le P&L de décembre (ou de l'exercice) lit 0 après clôture et les
-- colonnes de période du TB sont gonflées par l'écriture technique de clôture.
--   • get_profit_loss_v2 : year_close exclue du WHERE (rapport de résultat).
--   • get_trial_balance_v3 : year_close exclue des colonnes de PÉRIODE uniquement
--     (per_debit/per_credit, donc totaux + invariant Σ — JE entière, toutes classes,
--     l'invariant reste vrai) ; opening_balance et cumul l'INCLUENT (3200 doit
--     porter le report, les 4/5/6 rouvrent à 0).
--   • get_balance_sheet_v2 : AUCUN changement — CYE calculé YTD (year-start → as-of),
--     la year_close du 31/12 le remet à 0 en fin d'exercice et le cumul 32% porte
--     le report (vérifié : delta inchangé pré/post clôture, 3200 +net).
-- COR in-place ×2 (signatures/retours inchangés, bugfix de rapport — précédent _057).

-- ============================================================
-- 1. get_profit_loss_v2 — exclusion year_close
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
      AND je.reference_type IS DISTINCT FROM 'year_close'
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

COMMENT ON FUNCTION public.get_profit_loss_v2(DATE, DATE, UUID) IS
  'S50 W1.2 P&L (gate reports.financial.read, dédup sale_void+refund) + S54 : '
  'JE year_close exclue (la clôture annuelle ne doit pas zéroter le rapport).';

-- ============================================================
-- 2. get_trial_balance_v3 — year_close exclue des colonnes de période
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_trial_balance_v3(p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lines JSONB; v_total_debit NUMERIC(14,2); v_total_credit NUMERIC(14,2);
  v_balanced BOOLEAN; v_delta NUMERIC(14,2);
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.tb.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.tb.read' USING ERRCODE = '42501';
  END IF;
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  WITH agg AS (
    SELECT a.id, a.code, a.name, a.account_class, a.balance_type,
      -- Période [start, end] — year_close exclue (écriture technique de clôture ;
      -- JE entière toutes classes → l'invariant Σ débit = Σ crédit reste vrai)
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
                AND je.reference_type IS DISTINCT FROM 'year_close'
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS per_debit,
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
                AND je.reference_type IS DISTINCT FROM 'year_close'
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS per_credit,
      -- Ouverture (cumul strictement avant start — year_close INCLUSE : 3200 porte
      -- le report, les 4/5/6 rouvrent à 0)
      SUM(CASE WHEN je.entry_date < p_date_start
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS open_debit,
      SUM(CASE WHEN je.entry_date < p_date_start
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS open_credit,
      -- Cumul as-of end (= ouverture + période — year_close INCLUSE)
      SUM(COALESCE(jel.debit, 0))::NUMERIC(14,2)  AS cum_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS cum_credit
    FROM accounts a
    LEFT JOIN (
      journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.status IN ('posted','locked')
        AND je.entry_date <= p_date_end
        AND NOT (je.reference_type = 'sale_void'
          AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id))
    ) ON jel.account_id = a.id
    WHERE a.is_active = TRUE
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'account_id', id, 'code', code, 'name', name, 'account_class', account_class,
        'balance_type', balance_type,
        -- Colonnes Débit/Crédit affichées = mouvements de période (compat v2)
        'total_debit', per_debit, 'total_credit', per_credit,
        -- Solde d'ouverture signé (cumul < start)
        'opening_balance', CASE balance_type WHEN 'debit' THEN (open_debit - open_credit)
                                             ELSE (open_credit - open_debit) END,
        -- Solde : permanents (1/2/3) = cumul as-of end ; résultat (4/5/6) = net de période
        'balance', CASE
          WHEN account_class IN (1,2,3) THEN
            CASE balance_type WHEN 'debit' THEN (cum_debit - cum_credit)
                              ELSE (cum_credit - cum_debit) END
          ELSE
            CASE balance_type WHEN 'debit' THEN (per_debit - per_credit)
                              ELSE (per_credit - per_debit) END
        END)
      ORDER BY code)
      FILTER (WHERE per_debit <> 0 OR per_credit <> 0
              OR (account_class IN (1,2,3) AND (cum_debit <> 0 OR cum_credit <> 0))),
      '[]'::JSONB),
    -- Totaux + invariant : mouvements de période (s'équilibrent toujours)
    COALESCE(SUM(per_debit), 0), COALESCE(SUM(per_credit), 0)
  INTO v_lines, v_total_debit, v_total_credit FROM agg;

  v_delta := (v_total_debit - v_total_credit)::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'lines', v_lines, 'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'balanced', v_balanced, 'delta', v_delta);
END; $function$;

COMMENT ON FUNCTION public.get_trial_balance_v3(date, date) IS
  'S50 2a-i TB cumulative as-of + S54 : fix leak cumul (join interne jel/je) et '
  'year_close exclue des colonnes de période (incluse dans ouverture/cumul). '
  'Gate accounting.tb.read.';
