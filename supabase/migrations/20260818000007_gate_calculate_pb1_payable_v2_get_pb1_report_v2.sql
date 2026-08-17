-- 20260818000007_gate_calculate_pb1_payable_v2_get_pb1_report_v2.sql
--
-- Lot D1 (arbitrage Mamat) — ferme un trou d'accès : calculate_pb1_payable_v1
-- est SECURITY DEFINER, GRANT authenticated, SANS gate has_permission — tout
-- compte authentifié pouvait lire le montant de PB1 dû au Bapenda. Bump
-- calculate_pb1_payable_v2 avec le gate reports.financial.read (symétrie
-- avec get_pb1_report). La règle « jamais éditer une _vN publiée » force la
-- cascade complète : get_pb1_report_v1 est le seul appelant de
-- calculate_pb1_payable_v1 — elle est donc bumpée en get_pb1_report_v2, qui
-- appelle la v2 (corps sinon inchangé). DROP des DEUX v1 dans la même
-- migration.
--
-- Profite du passage pour corriger le résidu ADR-005 dans le corps de
-- calculate_pb1_payable v2 : tax_regime 'NON_PKP_BALI_PB1' → juridique erroné
-- (Bali/PEMDA) → 'NON_PKP_LOMBOK_PBJT' (PBJT Makanan dan Minuman, Bapenda
-- Lombok/NTB, UU HKPD 1/2022) — the-Breakery est à Lombok, pas Bali. Voir
-- docs/adr/005-juridiction-fiscale-lombok-pbjt.md (supersede ADR-003).
-- Aucun autre changement de logique dans les corps.

-- ============================================================================
-- calculate_pb1_payable_v2 — gate reports.financial.read + correction Lombok
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_pb1_payable_v2(p_period_start date, p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_pb1_id      UUID;
  v_pb1_output  DECIMAL(14,2);
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0002';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  v_pb1_id := resolve_mapping_account('SALE_PB1_TAX');

  -- PB1 output = Σ credits on 2110 over period − Σ debits (reversals on voids/refunds).
  -- Dédup (S50 Vague 2a-i) : exclure la JE sale_void quand un refund existe pour le
  -- même order — sinon void + refund contre-passent 2110 deux fois → PB1 sous-déclaré.
  -- Mirror exact de get_profit_loss_v2 (S26 _017/_018).
  SELECT COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    INTO v_pb1_output
    FROM journal_entry_lines jel
    JOIN journal_entries     je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND je.status IN ('posted', 'locked')
      AND NOT (je.reference_type = 'sale_void'
               AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id));

  RETURN jsonb_build_object(
    'period_start', p_period_start,
    'period_end',   p_period_end,
    'pb1_output',   v_pb1_output,
    'pb1_payable',  v_pb1_output,
    'tax_rate',     current_pb1_rate(),
    'tax_regime',   'NON_PKP_LOMBOK_PBJT',
    'note',         'NON-PKP — PBJT Makanan dan Minuman payable to Bapenda Lombok/NTB (UU HKPD 1/2022). No VAT input deduction (ADR-005).'
  );
END;
$function$;

COMMENT ON FUNCTION public.calculate_pb1_payable_v2(date, date) IS
  'Lot D1 : bump _v1→_v2, ajoute le gate reports.financial.read (trou d''accès '
  'fermé — _v1 était authenticated sans permission check). Corps inchangé sinon '
  'correction ADR-005 : tax_regime NON_PKP_LOMBOK_PBJT (PBJT Makanan dan Minuman, '
  'Bapenda Lombok/NTB, UU HKPD 1/2022), remplace le résidu ADR-003 NON_PKP_BALI_PB1. '
  'pb1_payable = Σ credits on SALE_PB1_TAX (2110) - Σ debits over period, dédup '
  'sale_void/refund (S50 Vague 2a-i). Pas de soustraction vat_input (non '
  'récupérable, folded in inventory cost).';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.calculate_pb1_payable_v2(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calculate_pb1_payable_v2(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.calculate_pb1_payable_v2(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ============================================================================
-- get_pb1_report_v2 — cascade forcée (seul appelant de calculate_pb1_payable),
-- corps v1 verbatim, seule différence : appelle calculate_pb1_payable_v2.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pb1_report_v2(p_period_month integer, p_period_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_start_date     DATE;
  v_end_date       DATE;
  v_pb1_rate       NUMERIC;
  v_taxable_base   NUMERIC(15,2);
  v_pb1_collected  NUMERIC(15,2);
  v_pb1_payable    NUMERIC(15,2);
  v_pb1_account_id UUID;
  v_balance        NUMERIC(15,2);
  v_by_day         JSONB;
  v_calc           JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;
  IF p_period_month < 1 OR p_period_month > 12 THEN
    RAISE EXCEPTION 'Invalid month: %', p_period_month USING ERRCODE = '22023';
  END IF;
  IF p_period_year < 2000 OR p_period_year > 2100 THEN
    RAISE EXCEPTION 'Invalid year: %', p_period_year USING ERRCODE = '22023';
  END IF;

  v_start_date := make_date(p_period_year, p_period_month, 1);
  v_end_date   := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::date;

  v_pb1_rate := current_pb1_rate();

  -- Taxable base = subtotal (excl. tax), pb1_collected = tax_amount from orders
  SELECT
    COALESCE(SUM(subtotal),    0),
    COALESCE(SUM(tax_amount),  0)
  INTO v_taxable_base, v_pb1_collected
  FROM orders
  WHERE created_at::date BETWEEN v_start_date AND v_end_date
    AND status NOT IN ('voided');

  -- Reuse calculate_pb1_payable helper — signature: (p_period_start DATE, p_period_end DATE)
  -- DEV-S30-1.B-01: actual signature uses DATE args, not TEXT as originally assumed
  -- Lot D1 : bump _v1→_v2 — calculate_pb1_payable a gagné le gate reports.financial.read,
  -- règle RPC versioning monotone oblige (jamais éditer une _vN publiée).
  v_calc := calculate_pb1_payable_v2(v_start_date, v_end_date);
  v_pb1_payable := COALESCE((v_calc->>'pb1_payable')::numeric, v_pb1_collected);

  -- Balance on account 2110 (PB1 Payable) at period end
  SELECT id INTO v_pb1_account_id FROM accounts WHERE code = '2110' LIMIT 1;
  IF v_pb1_account_id IS NOT NULL THEN
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
    INTO v_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_account_id
      AND je.entry_date <= v_end_date;
  ELSE
    v_balance := 0;
  END IF;

  -- Daily breakdown
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      created_at::date                AS day,
      COALESCE(SUM(subtotal),   0)   AS taxable_base,
      COALESCE(SUM(tax_amount), 0)   AS pb1_collected
    FROM orders
    WHERE created_at::date BETWEEN v_start_date AND v_end_date
      AND status NOT IN ('voided')
    GROUP BY created_at::date
  ) t;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'month', p_period_month,
      'year',  p_period_year,
      'start', v_start_date::text,
      'end',   v_end_date::text
    ),
    'pb1_rate',              v_pb1_rate,
    'taxable_base',          v_taxable_base,
    'pb1_collected',         v_pb1_collected,
    'pb1_payable',           v_pb1_payable,
    'by_day',                v_by_day,
    'balance_account_code',  '2110',
    'balance_at_period_end', v_balance
  );
END;
$function$;

COMMENT ON FUNCTION public.get_pb1_report_v2(integer, integer) IS
  'Lot D1 : bump _v1→_v2, cascade forcée par le bump de calculate_pb1_payable '
  '(seul appelant, règle RPC versioning monotone). Corps inchangé sinon l''appel '
  'à calculate_pb1_payable_v2. PB1 monthly report (NON-PKP, ADR-005). Utilise '
  'current_pb1_rate() + calculate_pb1_payable_v2(p_period_start DATE, '
  'p_period_end DATE). Retourne taxable_base, pb1_collected, pb1_payable, '
  'by_day, balance sur le compte 2110. Exclut les commandes annulées. Gate '
  'reports.financial.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_pb1_report_v2(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pb1_report_v2(integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_pb1_report_v2(integer, integer) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ============================================================================
-- DROP des deux _v1 (même migration que la création des _v2 — RPC versioning
-- monotone, CLAUDE.md).
-- ============================================================================

DROP FUNCTION public.calculate_pb1_payable_v1(date, date);
DROP FUNCTION public.get_pb1_report_v1(integer, integer);
