-- S50 Vague 2a-i · T3 — get_trial_balance → v3 : soldes cumulatifs as-of pour les comptes permanents
--
-- get_trial_balance_v2 sommait UNIQUEMENT les écritures dans [p_date_start, p_date_end].
-- Conséquence : pour les comptes permanents (bilan : classe 1 actif / 2 passif / 3 capitaux),
-- le solde n'incluait PAS le solde d'ouverture (cumul antérieur à p_date_start) → un TB de juin
-- affichait seulement les mouvements de juin, pas le vrai solde de caisse/AR/AP. Faux pour un
-- trial balance, dont la raison d'être est de présenter le solde réel de chaque compte.
--
-- v3 :
--   • balance (par ligne) :
--       - comptes permanents (classe 1/2/3) : CUMUL as-of p_date_end (ouverture < start + période),
--         signé selon balance_type → reflète enfin le vrai solde de bilan ;
--       - comptes de résultat (classe 4/5/6) : net de PÉRIODE [start, end] seul (ils se « remettent
--         à zéro » à chaque exercice — pas de report d'ouverture dans le TB worksheet).
--   • opening_balance (NOUVEAU, par ligne) : solde signé strictement avant p_date_start (utile au
--     rapprochement des comptes permanents ; renseigné pour tous, non affiché par défaut côté BO).
--   • total_debit / total_credit / balanced / delta : INCHANGÉS vs v2 = MOUVEMENTS de période.
--     L'invariant Σ débit = Σ crédit de la page (« Asserts Σ debit = Σ credit ») porte sur les
--     mouvements de période, qui s'équilibrent toujours (chaque JE est équilibrée) — donc pas de
--     faux « Unbalanced » tant que la clôture annuelle (report résultat → 3200) n'est pas implémentée.
--
-- Filtre des lignes : on conserve les lignes à mouvement de période non nul ET, en plus, les comptes
-- permanents porteurs d'un solde cumulatif non nul même sans activité dans la période (sinon un compte
-- de caisse au repos ce mois-ci disparaîtrait du bilan).
--
-- Bump v2→v3 (sémantique du retour modifiée) + DROP v2 + REVOKE pair. Gate accounting.tb.read inchangé.
-- Réutilise le filtre canonique de dédup sale_void+refund (mirror get_profit_loss_v2 / v2).

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
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
      AND je.status IN ('posted','locked')
      AND je.entry_date <= p_date_end
      AND NOT (je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id))
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

-- DROP v2 (signature identique) + REVOKE pair sur v3 (defense-in-depth anon)
DROP FUNCTION IF EXISTS public.get_trial_balance_v2(date, date);

REVOKE ALL ON FUNCTION public.get_trial_balance_v3(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_trial_balance_v3(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_trial_balance_v3(date, date) TO authenticated;
