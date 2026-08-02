-- Lot 1 — Trois RPC de tresorerie etaient SECURITY DEFINER sans gate.
--
-- get_cash_wallet_balances_v1, get_cash_wallet_ledger_v2 et
-- get_cash_wallet_analysis_v1 sont SECURITY DEFINER — elles lisent donc le
-- grand livre avec les droits du proprietaire, en contournant la RLS — et
-- EXECUTE etait accorde a `authenticated` sans aucun has_permission. N importe
-- quel utilisateur connecte, un caissier compris, pouvait lire les soldes des
-- coffres, le detail des mouvements de caisse et l analyse de tresorerie
-- (retraits du patron inclus).
--
-- C est exactement la classe fermee la veille par 20260802000001 pour quatre
-- RPC de reporting, et par 20260802000004 pour get_cash_flow. Le pendant en
-- ecriture, record_cash_wallet_movement_v1, exige deja accounting.cash.write :
-- la lecture prend son pendant naturel, accounting.cash.read, que ADMIN,
-- MANAGER et SUPER_ADMIN portent, mais ni CASHIER ni waiter.
--
-- Corps repris verbatim de pg_get_functiondef ; balances passe de LANGUAGE sql
-- a plpgsql pour porter le gate (meme conversion que le bump v2 -> v3 de
-- get_sales_by_category la veille). Aucune logique metier n est modifiee.
--
-- ERRCODE 42501 : convention etablie dans toute la famille de lecture gatee.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_cash_wallet_balances_v2  (etait _v1, LANGUAGE sql)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cash_wallet_balances_v2()
RETURNS TABLE(account_code text, account_name text, balance numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.cash.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.cash.read' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.code, a.name,
         COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE a.code IN ('1110','1111','1117')
  GROUP BY a.code, a.name
  ORDER BY a.code;
END $function$;

DROP FUNCTION IF EXISTS public.get_cash_wallet_balances_v1();

REVOKE EXECUTE ON FUNCTION public.get_cash_wallet_balances_v2() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cash_wallet_balances_v2() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_cash_wallet_balances_v2() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_cash_wallet_ledger_v3  (etait _v2)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cash_wallet_ledger_v3(
  p_account_code text,
  p_date_start   date,
  p_date_end     date
)
RETURNS TABLE(row_date date, remark text, category text, description text, supplier text, in_amount numeric, out_amount numeric, saldo numeric, ref_type text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_acc_id  UUID;
  v_opening NUMERIC;
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.cash.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.cash.read' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_acc_id FROM accounts WHERE code = p_account_code;
  IF v_acc_id IS NULL THEN
    RAISE EXCEPTION 'unknown account code %', p_account_code USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_opening
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE jel.account_id = v_acc_id AND je.entry_date < p_date_start;

  RETURN QUERY
  WITH raw AS (
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (
              PARTITION BY je.entry_date ORDER BY MIN(s.opened_at)
           )::text AS rmk,
           NULL::text AS cat, NULL::text AS descr, NULL::text AS sup,
           SUM(jel.debit) AS in_amt, SUM(jel.credit) AS out_amt,
           'sale'::text AS rt, 1 AS grp
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    JOIN orders o          ON je.reference_type = 'sale' AND je.reference_id = o.id
    LEFT JOIN pos_sessions s ON s.id = o.session_id
    WHERE p_account_code = '1110'
      AND jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id

    UNION ALL

    SELECT je.entry_date AS d,
           COALESCE(jel.description, je.description) AS rmk,
           ec.name AS cat,
           ex.description AS descr,
           COALESCE(ex.vendor_name, sup.name) AS sup,
           jel.debit AS in_amt, jel.credit AS out_amt,
           je.reference_type AS rt, 0 AS grp
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    LEFT JOIN expenses ex            ON je.reference_type = 'expense'          AND je.reference_id = ex.id
    LEFT JOIN expense_categories ec  ON ec.id = ex.category_id
    LEFT JOIN purchase_payments pp   ON je.reference_type = 'purchase_payment' AND je.reference_id = pp.id
    LEFT JOIN purchase_orders po     ON po.id = pp.purchase_order_id
    LEFT JOIN suppliers sup          ON sup.id = po.supplier_id
    WHERE jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (p_account_code = '1110' AND je.reference_type = 'sale')
  ),
  ordered AS (
    SELECT d, rmk, cat, descr, sup, in_amt, out_amt, rt,
           row_number() OVER (ORDER BY d, grp DESC, rmk) AS rn
    FROM raw
  )
  SELECT o.d, o.rmk, o.cat, o.descr, o.sup, o.in_amt, o.out_amt,
         v_opening + SUM(o.in_amt - o.out_amt) OVER (ORDER BY o.rn
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo,
         o.rt
  FROM ordered o
  ORDER BY o.rn;
END $function$;

DROP FUNCTION IF EXISTS public.get_cash_wallet_ledger_v2(text, date, date);

REVOKE EXECUTE ON FUNCTION public.get_cash_wallet_ledger_v3(text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cash_wallet_ledger_v3(text, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_cash_wallet_ledger_v3(text, date, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_cash_wallet_analysis_v2  (etait _v1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cash_wallet_analysis_v2(
  p_date_start date,
  p_date_end   date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue_by_shift JSONB;
  v_top_petty        JSONB;
  v_deposits         NUMERIC;
  v_boss             NUMERIC;
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.cash.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.cash.read' USING ERRCODE = '42501';
  END IF;

  -- Revenue per shift = cash-sale debits on 1110 grouped per session, ranked per day.
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_revenue_by_shift FROM (
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (PARTITION BY je.entry_date ORDER BY MIN(s.opened_at))::text AS shift,
           SUM(jel.debit) AS total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status='posted'
    JOIN accounts a ON a.id = jel.account_id AND a.code='1110'
    JOIN orders o ON je.reference_type='sale' AND je.reference_id=o.id
    LEFT JOIN pos_sessions s ON s.id=o.session_id
    WHERE je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id
    ORDER BY je.entry_date
  ) t;

  -- Top Petty Cash spend categories = expense JE crediting 1111, grouped by category account.
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_petty FROM (
    SELECT cat.name AS category, SUM(line.debit) AS total, count(*) AS occurrences
    FROM journal_entries je
    JOIN journal_entry_lines credit ON credit.journal_entry_id=je.id
      JOIN accounts ca ON ca.id=credit.account_id AND ca.code='1111' AND credit.credit > 0
    JOIN journal_entry_lines line ON line.journal_entry_id=je.id AND line.debit > 0
    JOIN accounts cat ON cat.id=line.account_id
    WHERE je.reference_type='expense' AND je.status='posted'
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY cat.name
    ORDER BY SUM(line.debit) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(SUM(jel.debit),0) INTO v_deposits
  FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id=je.id
  JOIN accounts a ON a.id=jel.account_id AND a.code='1112'
  WHERE je.reference_type='cash_movement' AND je.status='posted'
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  SELECT COALESCE(SUM(jel.debit),0) INTO v_boss
  FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id=je.id
  JOIN accounts a ON a.id=jel.account_id AND a.code='3110'
  WHERE je.reference_type='cash_movement' AND je.status='posted'
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  RETURN jsonb_build_object(
    'revenue_by_shift', v_revenue_by_shift,
    'top_petty_categories', v_top_petty,
    'deposits_total', v_deposits,
    'boss_withdrawals_total', v_boss
  );
END $function$;

DROP FUNCTION IF EXISTS public.get_cash_wallet_analysis_v1(date, date);

REVOKE EXECUTE ON FUNCTION public.get_cash_wallet_analysis_v2(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cash_wallet_analysis_v2(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_cash_wallet_analysis_v2(date, date) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
