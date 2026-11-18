-- Bilan v5 : les actifs hors des préfixes connus ne disparaissent plus.
--
-- La v4 ne compte que les actifs 111x (trésorerie), 113x (créances), 114x
-- (stocks) et 115x (« autres ») ; ses immobilisations valent toujours 0. Les
-- comptes de la charte de la société (20261117000002 : avances au personnel
-- 1400, loyer payé d'avance 1410, prêts consentis 1450/1460, immobilisations
-- 1600/1610 et amortissements 1690) sortiraient donc du total de l'actif, et le
-- bilan se déclarerait déséquilibré dès la première écriture sur eux.
--
-- Corps repris de `pg_get_functiondef(get_balance_sheet_v4)` sur la base dev le
-- 2026-11-17. Deux changements seulement :
--   - « other current » = toute la classe 1 hors 111x, 113x, 114x et 16xx ;
--   - « fixed » = les comptes 16xx (amortissements cumulés en négatif inclus).
-- Contrat de sortie inchangé : le front lit les mêmes clés.
--
-- Additif : la v4 reste en place tant que le back-office publié l'appelle. Son
-- retrait suit la publication du BO (même séquence que les bumps de rapport).

CREATE OR REPLACE FUNCTION public.get_balance_sheet_v5(p_as_of_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assets_cash NUMERIC(14,2):=0; v_assets_ar NUMERIC(14,2):=0; v_assets_inv NUMERIC(14,2):=0; v_assets_other NUMERIC(14,2):=0;
  v_assets_current NUMERIC(14,2):=0; v_assets_fixed NUMERIC(14,2):=0; v_assets_total NUMERIC(14,2):=0;
  v_liab_ap NUMERIC(14,2):=0; v_liab_tax NUMERIC(14,2):=0; v_liab_loyalty NUMERIC(14,2):=0; v_liab_other NUMERIC(14,2):=0;
  v_liab_current NUMERIC(14,2):=0; v_liab_long NUMERIC(14,2):=0; v_liab_total NUMERIC(14,2):=0;
  v_eq_capital NUMERIC(14,2):=0; v_eq_retained NUMERIC(14,2):=0; v_eq_other NUMERIC(14,2):=0; v_eq_total NUMERIC(14,2):=0;
  v_cye_revenue NUMERIC(14,2):=0; v_cye_cogs NUMERIC(14,2):=0; v_cye_opex NUMERIC(14,2):=0; v_cye NUMERIC(14,2):=0;
  v_ytd_start DATE; v_delta NUMERIC(14,2):=0; v_balanced BOOLEAN:=FALSE; v_lines JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.assert_stock_owner_v1();
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'get_balance_sheet_v5: p_as_of_date is required';
  END IF;
  v_ytd_start := date_trunc('year', p_as_of_date::TIMESTAMP)::DATE;
  WITH agg AS (
    SELECT a.id AS account_id, a.code, a.name, a.account_class, a.balance_type,
      SUM(COALESCE(jel.debit, 0))::NUMERIC(14,2) AS d, SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS c
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.status IN ('posted','locked') AND je.entry_date <= p_as_of_date AND a.account_class IN (1, 2, 3)
      AND NOT (je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '111%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '113%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '114%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code NOT LIKE '111%' AND code NOT LIKE '113%'
                       AND code NOT LIKE '114%' AND code NOT LIKE '16%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '16%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2141') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2110','2142','2143') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code = '2210' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code NOT IN ('2141','2110','2142','2143','2210') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code = '3100' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code LIKE '32%' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code NOT IN ('3100','3300') AND code NOT LIKE '32%' THEN (c - d) END), 0),
    COALESCE(jsonb_agg(jsonb_build_object('account_id', account_id, 'code', code, 'name', name, 'debit', d, 'credit', c,
      'balance', CASE WHEN balance_type = 'debit' THEN (d - c) ELSE (c - d) END, 'account_class', account_class)
      ORDER BY code) FILTER (WHERE d <> 0 OR c <> 0), '[]'::JSONB)
  INTO v_assets_cash, v_assets_ar, v_assets_inv, v_assets_other, v_assets_fixed, v_liab_ap, v_liab_tax, v_liab_loyalty, v_liab_other,
    v_eq_capital, v_eq_retained, v_eq_other, v_lines
  FROM agg;
  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0)
  INTO v_cye_revenue, v_cye_cogs, v_cye_opex
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked') AND je.entry_date BETWEEN v_ytd_start AND p_as_of_date
    AND a.account_class IN (4, 5, 6)
    AND NOT (je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));
  v_cye := (v_cye_revenue - v_cye_cogs - v_cye_opex)::NUMERIC(14,2);
  v_assets_current := (v_assets_cash + v_assets_ar + v_assets_inv + v_assets_other)::NUMERIC(14,2);
  v_assets_total := (v_assets_current + v_assets_fixed)::NUMERIC(14,2);
  v_liab_current := (v_liab_ap + v_liab_tax + v_liab_loyalty + v_liab_other)::NUMERIC(14,2);
  v_liab_total := (v_liab_current + v_liab_long)::NUMERIC(14,2);
  v_eq_total := (v_eq_capital + v_eq_retained + v_eq_other + v_cye)::NUMERIC(14,2);
  v_delta := (v_assets_total - (v_liab_total + v_eq_total))::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;
  RETURN jsonb_build_object(
    'assets', jsonb_build_object('current', jsonb_build_object('cash', v_assets_cash, 'ar', v_assets_ar,
      'inventory', v_assets_inv, 'other', v_assets_other, 'total', v_assets_current),
      'fixed', jsonb_build_object('total', v_assets_fixed), 'total', v_assets_total),
    'liabilities', jsonb_build_object('current', jsonb_build_object('ap', v_liab_ap, 'tax_payable', v_liab_tax,
      'loyalty', v_liab_loyalty, 'other', v_liab_other, 'total', v_liab_current),
      'long_term', jsonb_build_object('total', v_liab_long), 'total', v_liab_total),
    'equity', jsonb_build_object('share_capital', v_eq_capital, 'retained_earnings', v_eq_retained,
      'current_year_earnings', v_cye, 'other', v_eq_other, 'total', v_eq_total),
    'balanced', v_balanced, 'delta', v_delta, 'as_of', p_as_of_date, 'lines', v_lines);
END; $function$;

REVOKE ALL ON FUNCTION public.get_balance_sheet_v5(p_as_of_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet_v5(p_as_of_date date) TO authenticated, service_role;
