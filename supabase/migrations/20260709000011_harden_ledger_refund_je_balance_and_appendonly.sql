-- LOT 2 — General ledger integrity (audit 2026-06-25, U2).
--
-- Three fixes in one migration:
--  R2.1  fn_create_je_for_refund: add a fallback CR line (cash) when the refund has
--        NO refund_payments rows. Today the trigger posts the DR lines (sales + PB1)
--        then loops refund_payments for the CR lines; an empty refund_payments leaves
--        the entry with DR but no CR -> unbalanced journal entry.
--  R2.2  REVOKE INSERT/UPDATE/DELETE on journal_entries + journal_entry_lines from
--        authenticated and PUBLIC (align to stock_movements append-only). All JE writes
--        go through SECURITY DEFINER triggers/RPCs, so this is defense-in-depth at the
--        grant level on top of the existing deny-by-default RLS.
--  R2.3  Data-fix: backfill the missing CR line on the 8 orphan 'sale_refund' JE
--        (2026-05-20, 20000 each = 160000 IDR) that currently unbalance the trial
--        balance. Idempotent (guarded by NOT EXISTS of a CR line).
--
-- Spec: docs/superpowers/specs/2026-06-25-pos-p0-hardening.md

-- R2.1 — fallback CR line in the refund JE trigger -------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_je_for_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_je_id        UUID;
  v_existing     UUID;
  v_entry_no     TEXT;
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_net          DECIMAL(14,2);
  v_pay          RECORD;
  v_order_number TEXT;
  v_cash_id      UUID;
  v_mapping_key  TEXT;
BEGIN
  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'sale_refund' AND reference_id = NEW.id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_net := NEW.total - NEW.tax_refunded;
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  SELECT order_number INTO v_order_number FROM orders WHERE id = NEW.order_id;

  v_entry_no := next_journal_entry_number(NEW.created_at::date);

  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)
  VALUES (v_entry_no, NEW.created_at::date,
          'Refund ' || NEW.refund_number || ' (order ' || COALESCE(v_order_number, '?') || ')',
          'sale_refund', NEW.id, 'posted', NEW.total, NEW.total, NEW.refunded_by)
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_sales_id, v_net,            0, 'Sales revenue (refund)'),
    (v_je_id, v_pb1_id,   NEW.tax_refunded, 0, 'PB1 payable (refund)');

  FOR v_pay IN SELECT method, amount FROM refund_payments WHERE refund_id = NEW.id LOOP
    v_mapping_key := CASE v_pay.method::TEXT
      WHEN 'cash'        THEN 'SALE_PAYMENT_CASH'
      WHEN 'qris'        THEN 'SALE_PAYMENT_QRIS'
      WHEN 'debit_card'  THEN 'SALE_PAYMENT_DEBIT'
      WHEN 'credit_card' THEN 'SALE_PAYMENT_CREDIT_CARD'
      ELSE 'SALE_PAYMENT_CASH'
    END;
    v_cash_id := resolve_mapping_account(v_mapping_key);
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cash_id, 0, v_pay.amount,
      'Cash refund (' || v_pay.method::TEXT || ')');
  END LOOP;

  -- R2.1 fallback: guarantee the entry balances even when no refund_payments exist.
  IF NOT EXISTS (SELECT 1 FROM refund_payments WHERE refund_id = NEW.id) THEN
    v_cash_id := resolve_mapping_account('SALE_PAYMENT_CASH');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cash_id, 0, NEW.total, 'Cash refund (fallback — no tender recorded)');
  END IF;

  RETURN NEW;
END $function$;

-- R2.2 — ledger append-only at the grant level ----------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.journal_entries      FROM authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.journal_entry_lines  FROM authenticated, PUBLIC;

-- R2.3 — backfill the missing CR line on orphan sale_refund JE (idempotent) ------
INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
SELECT je.id, resolve_mapping_account('SALE_PAYMENT_CASH'), 0, je.total_credit,
       'Cash refund (backfill — orphan JE rebalance, audit 2026-06-25)'
FROM public.journal_entries je
WHERE je.reference_type = 'sale_refund'
  AND je.total_credit > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entry_lines l
    WHERE l.journal_entry_id = je.id AND l.credit > 0
  );
