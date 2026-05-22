-- 20260603000017_bump_get_profit_loss_v1_dedupe_void_refund.sql
-- Session 26 / Wave 1.G / migration _017 :
--   Bump get_profit_loss_v1 pour exclure les JE 'sale_void' quand un refund
--   existe pour le même order — évite le double counting des reversal full-void.
--
-- Closes audit finding F-S26-AC-04 (audit V3 critique).
--
-- Contexte :
-- - void_order_rpc insère 1 row dans `refunds` qui déclenche fn_create_je_for_refund
--   → JE reference_type='sale_refund', reference_id=refunds.id
-- - PLUS le trigger create_sale_journal_entry sur orders.status='voided' génère
--   un JE reference_type='sale_void', reference_id=orders.id
-- - Les 2 JEs reverse la même vente → DOUBLE-counting de la reduction
--   de revenue et de cash.
--
-- Fix (option a) : dans get_profit_loss_v1, exclure les JE 'sale_void' quand
-- un `refunds` row existe pour la même order (NOT EXISTS).
--
-- Option (b) alternative : void_order_rpc ne crée plus de refund mirror pour
-- full-voids. Plus invasive, demande de refactor void_order_rpc et risque
-- de casser POS/BO consumers. Reporté en backlog.

CREATE OR REPLACE FUNCTION public.get_profit_loss_v1(
  p_date_start  DATE,
  p_date_end    DATE,
  p_section_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
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
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_profit_loss_v1: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_profit_loss_v1: p_date_start (%) must be <= p_date_end (%)',
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
    JOIN journal_entries je
      ON je.id = jel.journal_entry_id
    JOIN accounts a
      ON a.id = jel.account_id
    WHERE je.status IN ('posted', 'locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND a.account_class IN (4, 5, 6)
      -- F-S26-AC-04 : dedupe sale_void si refund existe pour même order
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
    'gross_profit', (v_revenue - v_cogs)::NUMERIC(14,2),
    'opex', jsonb_build_object(
      'salary',     v_opex_salary,
      'rent',       v_opex_rent,
      'utilities',  v_opex_util,
      'supplies',   v_opex_supplies,
      'marketing',  v_opex_marketing,
      'maintenance',v_opex_maint,
      'other',      v_opex_other,
      'total',      v_opex
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

COMMENT ON FUNCTION public.get_profit_loss_v1(DATE, DATE, UUID) IS
  'F-S26-AC-04 : dedupe sale_void quand refund existe pour même order. Pour le '
  'reste identique à S13. Plus de double-counting de revenue/COGS sur les full-voids.';
