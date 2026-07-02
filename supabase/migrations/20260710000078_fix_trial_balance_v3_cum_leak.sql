-- S54 P1.3 · T6 — fix leak cumul TB v3 : le double LEFT JOIN de _061 laissait
-- survivre les lignes jel dont la JE échoue les filtres du join je (draft, datée
-- > p_date_end, sale_void dédupliquée) — la ligne (a, jel, NULL) restait et
-- cum_debit/cum_credit = SUM(jel.*) inconditionnel l'absorbait → soldes cumulés
-- des comptes permanents pollués (reproduit : posted 100 + draft 40 + future 25
-- → balance 165 au lieu de 100).
-- Fix : join interne parenthésé (jel JOIN je) — une ligne jel n'entre dans
-- l'agrégat que si sa JE passe les filtres. COR in-place (signature/retour
-- inchangés, bugfix — précédent _057).

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
      -- Période [start, end]
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS per_debit,
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS per_credit,
      -- Ouverture (cumul strictement avant start)
      SUM(CASE WHEN je.entry_date < p_date_start
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS open_debit,
      SUM(CASE WHEN je.entry_date < p_date_start
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS open_credit,
      -- Cumul as-of end (= ouverture + période)
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
  'S50 2a-i TB cumulative as-of + S54 fix leak cumul (join interne jel/je : draft, '
  'futures et sale_void dédupliquées exclues du cumul). Gate accounting.tb.read.';
