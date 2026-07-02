-- S54 P1.3 · T6 — garde fiscale fail-closed
-- check_fiscal_period_open (D12, 20260517000002) RETURNait silencieusement quand
-- aucune fiscal_period ne couvre p_date (« seed-gap-tolerant ») → toute JE datée
-- hors seed passait sans garde (audit T6 : garde fail-open). Fail-closed :
-- period_undefined (P0004, même ERRCODE que period_locked — les 34 call-sites
-- traitent déjà P0004 comme rejet de garde). Le seed N+1 est garanti par
-- close_fiscal_year_v1 (même vague) — pas de bombe à retardement jan 2028.
-- COR in-place : signature inchangée, bugfix de garde (précédent _057).

CREATE OR REPLACE FUNCTION check_fiscal_period_open(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'date_required_for_period_check' USING ERRCODE = 'P0002';
  END IF;

  SELECT status INTO v_status
    FROM fiscal_periods
    WHERE p_date BETWEEN period_start AND period_end
    LIMIT 1;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'period_undefined: no fiscal period covers %', p_date
      USING ERRCODE = 'P0004';
  END IF;

  IF v_status IN ('closed','locked') THEN
    RAISE EXCEPTION 'period_locked: date % falls in % period', p_date, v_status
      USING ERRCODE = 'P0004';
  END IF;
END;
$$;

COMMENT ON FUNCTION check_fiscal_period_open(DATE) IS
  'D12 helper, fail-closed depuis S54 (T6). RAISE period_locked (P0004) quand p_date '
  'tombe dans une période closed/locked, period_undefined (P0004) quand aucune période '
  'ne couvre p_date. Appelé depuis chaque RPC/trigger émetteur de JE. Le seed N+1 '
  'passe par close_fiscal_year_v1.';
