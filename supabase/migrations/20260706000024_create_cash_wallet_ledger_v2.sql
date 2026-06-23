-- 20260706000024_create_cash_wallet_ledger_v2.sql
-- Cash Wallets : ledger v2 — adds category / description / supplier columns.
--
-- The treasury ledger feeds off posted journal_entry_lines. Most non-sale rows
-- originate from an expense (reference_type='expense') or a purchase payment
-- (reference_type='purchase_payment'). v1 only surfaced a single "remark"; v2
-- enriches each row with the business context users asked for on the page:
--   - category    : expense category name (expense rows only)
--   - description : expense free-text description (expense rows only)
--   - supplier    : expense vendor_name, else the PO supplier name (purchase_payment)
-- Sale rows (Undeposited shift aggregation) carry NULL for the three new fields.
--
-- RETURN signature changes (new OUT columns) → Postgres requires DROP + recreate.
-- Per project convention we bump to _v2 and DROP _v1 in the same migration.

DROP FUNCTION IF EXISTS get_cash_wallet_ledger_v1(TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION get_cash_wallet_ledger_v2(
  p_account_code TEXT,
  p_date_start   DATE,
  p_date_end     DATE
) RETURNS TABLE(
  row_date    DATE,
  remark      TEXT,
  category    TEXT,
  description TEXT,
  supplier    TEXT,
  in_amount   NUMERIC,
  out_amount  NUMERIC,
  saldo       NUMERIC,
  ref_type    TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acc_id  UUID;
  v_opening NUMERIC;
BEGIN
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
    -- Undeposited cash sales → aggregate per session as one "Shift N" row.
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

    -- All non-sale lines (and ALL lines for non-Undeposited wallets) pass through 1:1,
    -- enriched with expense / purchase-payment context where available.
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
END $$;

COMMENT ON FUNCTION get_cash_wallet_ledger_v2(TEXT,DATE,DATE) IS
  'Cash Wallets : In/Out/Saldo ledger for one wallet, opening carry-forward, Undeposited '
  'sales aggregated per shift. v2 adds category/description/supplier (expense + purchase_payment context).';
REVOKE EXECUTE ON FUNCTION get_cash_wallet_ledger_v2(TEXT,DATE,DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_cash_wallet_ledger_v2(TEXT,DATE,DATE) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
