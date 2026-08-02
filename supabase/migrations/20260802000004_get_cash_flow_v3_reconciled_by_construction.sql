-- Cash flow — la réconciliation devient une identité, pas une espérance.
--
-- PROBLÈME. get_cash_flow_v2 posait `net_change_in_cash := operating_total` et
-- ne confrontait jamais ce résultat à `cash_end - cash_start`. Sa section
-- opérationnelle énumérait trois familles de comptes (113x AR, 114x inventaire,
-- 2141 AP) : tout poste de bilan hors de cette liste était invisible. Le poste
-- manquant était la PB1 collectée — encaissée en trésorerie, créditée en 2110
-- (classe 2), donc absente à la fois du résultat et du BFR retenu.
-- Mesure au 2026-08-02 : sur juillet 2026 le rapport annonçait -515 546 quand la
-- trésorerie montait de +628 554 ; l'écart de 1 144 100 égalait au centime le
-- crédit net de 2110. Sur mars→juillet, écart 1 293 040 = 1 297 000 (2110)
-- - 3 960 (1151). Le signe lui-même était faux.
--
-- CORRECTION. On ne rallonge pas la liste des comptes — la prochaine création de
-- compte rouvrirait l'écart en silence. On calcule par CONTREPARTIE : toute
-- écriture touchant un compte non-trésorerie est classée dans une des trois
-- sections. La partie double donne alors
--     operating + investing + financing = Δ trésorerie
-- comme identité arithmétique, quels que soient les comptes créés plus tard.
--
-- La trésorerie est désignée par `accounts.cash_flow_section = 'none'`, unique
-- source de vérité (v2 la codait en dur par `code LIKE '111%'`).

-- ── 1. Classification du plan comptable ─────────────────────────────────────
-- La colonne existait déjà (enum cash_flow_section) mais n'avait jamais été
-- renseignée : son DEFAULT 'operating' avait tout absorbé, y compris les huit
-- comptes de trésorerie — qui se retrouvaient comptés à la fois comme flux et
-- comme solde. Aucun compte n'était en 'none', aucun en 'investing'.

-- La trésorerie et ses équivalents : ils SONT le cash, ils n'en sont pas la
-- contrepartie. 1110 Cash on Hand, 1111 Petty Cash, 1112 Bank Operating,
-- 1113 Bank Savings, 1114 Cash in Transit, 1115 QRIS Clearing,
-- 1116 Card Clearing, 1117 Small Money.
UPDATE accounts SET cash_flow_section = 'none'
 WHERE code LIKE '111%' AND cash_flow_section IS DISTINCT FROM 'none';

-- Capitaux propres : apports, retraits, report à nouveau, résultat de
-- l'exercice. Le virage de clôture 3300 → 3200 reste interne à la section et
-- s'y annule, sans créer de flux fictif.
UPDATE accounts SET cash_flow_section = 'financing'
 WHERE code LIKE '3%' AND cash_flow_section IS DISTINCT FROM 'financing';

-- Tout le reste est opérationnel : créances, stocks, dettes d'exploitation
-- (dont 2110 PB1 Payable, 2141 fournisseurs, 2210 fidélité, 2220 avoirs) et les
-- comptes de résultat. `financing` cessait d'être exact pour 2100/2110/2141/
-- 2142/2143 : une dette d'exploitation n'est pas du financement.
UPDATE accounts SET cash_flow_section = 'operating'
 WHERE code NOT LIKE '111%' AND code NOT LIKE '3%'
   AND cash_flow_section IS DISTINCT FROM 'operating';

COMMENT ON COLUMN accounts.cash_flow_section IS
  'Section du tableau de flux de trésorerie. ''none'' = ce compte EST de la trésorerie (son solde alimente cash_start/cash_end) ; les autres valeurs classent la contrepartie. get_cash_flow_v3 en dérive une réconciliation exacte par la partie double : tout compte non-''none'' doit donc être classé correctement.';

-- ── 2. La RPC ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cash_flow_v3(p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_net_profit       NUMERIC(14,2) := 0;
  v_revenue          NUMERIC(14,2) := 0;
  v_cogs             NUMERIC(14,2) := 0;
  v_opex             NUMERIC(14,2) := 0;
  v_delta_ar         NUMERIC(14,2) := 0;
  v_delta_ap         NUMERIC(14,2) := 0;
  v_delta_inv        NUMERIC(14,2) := 0;
  v_other            NUMERIC(14,2) := 0;
  v_operating_total  NUMERIC(14,2) := 0;
  v_investing_total  NUMERIC(14,2) := 0;
  v_financing_total  NUMERIC(14,2) := 0;
  v_cash_start       NUMERIC(14,2) := 0;
  v_cash_end         NUMERIC(14,2) := 0;
  v_net_change       NUMERIC(14,2) := 0;
  v_prior_end        DATE;
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_cash_flow_v3: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_cash_flow_v3: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  v_prior_end := (p_date_start - INTERVAL '1 day')::DATE;

  -- Les trois sections, par contrepartie. Chaque écriture non-trésorerie de la
  -- période compte exactement une fois : c'est ce qui rend la somme égale à la
  -- variation de trésorerie sans avoir à énumérer le moindre code de compte.
  SELECT
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'operating' THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'investing' THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'financing' THEN (jel.credit - jel.debit) END), 0)
  INTO v_operating_total, v_investing_total, v_financing_total
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND a.cash_flow_section <> 'none';

  -- Détail lisible de la section opérationnelle. Ces postes sont INFORMATIFS :
  -- ils ne fondent plus le total, ils l'expliquent.
  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '113%' THEN -(jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '114%' THEN -(jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2141'    THEN  (jel.credit - jel.debit) END), 0)
  INTO v_revenue, v_cogs, v_opex, v_delta_ar, v_delta_inv, v_delta_ap
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  v_net_profit := (v_revenue - v_cogs - v_opex)::NUMERIC(14,2);

  -- Le reste de la section opérationnelle : dettes fiscales (PB1 collectée),
  -- fidélité, avoirs client, et tout compte opérationnel créé après coup. En v2
  -- cette ligne valait 0 en dur, et c'est précisément là que l'écart se logeait.
  v_other := (v_operating_total
              - (v_net_profit + v_delta_ar + v_delta_ap + v_delta_inv))::NUMERIC(14,2);

  -- Soldes de trésorerie : les comptes marqués 'none', par définition.
  SELECT
    COALESCE(SUM(CASE WHEN je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(jel.debit - jel.credit), 0)
  INTO v_cash_start, v_cash_end
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date <= p_date_end
    AND a.cash_flow_section = 'none';

  v_net_change := (v_operating_total + v_investing_total + v_financing_total)::NUMERIC(14,2);

  RETURN jsonb_build_object(
    'operating', jsonb_build_object(
      'net_profit',           v_net_profit,
      'delta_ar',             v_delta_ar,
      'delta_ap',             v_delta_ap,
      'delta_inventory',      v_delta_inv,
      'non_cash_adjustments', v_other,
      'total',                v_operating_total
    ),
    'investing', jsonb_build_object('total', v_investing_total),
    'financing', jsonb_build_object('total', v_financing_total),
    'net_change_in_cash', v_net_change,
    'cash_start',         v_cash_start,
    'cash_end',           v_cash_end,
    'period', jsonb_build_object(
      'start', p_date_start,
      'end',   p_date_end
    )
  );
END;
$function$;

-- ── 3. Retrait des versions précédentes ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_cash_flow_v2(date, date);

-- cash_flow_v1 : méthode directe restée SECURITY INVOKER et SANS gate, alors que
-- les policies de journal_entries / journal_entry_lines / accounts sont
-- `is_authenticated()`. Tout compte authentifié — un caissier — pouvait donc en
-- lire la trésorerie complète ventilée par compte : exactement la fuite que le
-- bump get_cash_flow_v1 → v2 avait fermée sur la RPC voisine, laissée ouverte
-- ici sous un autre nom. Sa migration d'origine révoquait `anon` mais gardait
-- `authenticated`, et son pgTAP ne testait que `anon`. Aucun appelant (ni front,
-- ni Edge Function) : on la retire au lieu de la gater.
DROP FUNCTION IF EXISTS public.cash_flow_v1(date, date);

-- ── 4. Grants — anon hérite EXECUTE via PUBLIC, le REVOKE seul sur anon ne suffit pas
REVOKE EXECUTE ON FUNCTION public.get_cash_flow_v3(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cash_flow_v3(date, date) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_v3(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_v3(date, date) TO service_role;

COMMENT ON FUNCTION public.get_cash_flow_v3(date, date) IS
  'Tableau de flux de trésorerie, méthode indirecte par contrepartie. v3 : operating+investing+financing = cash_end-cash_start par identité de la partie double, au lieu de net_change := operating_total. Sections lues dans accounts.cash_flow_section (''none'' = trésorerie). Gatée reports.financial.read.';
