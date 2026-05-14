-- 20260517000013_refactor_refund_je.sql
-- Session 13 / Phase 1.A / migration 10-008b :
--   Refactor fn_create_je_for_refund (originally 20260512000005) to use
--   accounting_mappings + check_fiscal_period_open + idempotency pre-SELECT.
--   Lands UNCONDITIONALLY per D16 — the V3 trigger predates accounting_mappings.
--
-- Findings from Phase 0.1 audit (Decision Pack §"Refund JE audit") :
--   - Hardcoded codes '1110' / '4100' / '2110' (file 20260512000005 lines 30-32)  → fixed here
--   - No idempotency guard (a duplicate refunds row would post a second JE)      → fixed here
--   - No fiscal period guard                                                      → fixed here
--   - Client-side : no direct JE writes (clean)                                   → no change

DROP TRIGGER IF EXISTS trg_create_je_for_refund ON refunds;
DROP FUNCTION IF EXISTS fn_create_je_for_refund();

CREATE OR REPLACE FUNCTION fn_create_je_for_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
  -- Idempotency : skip if a 'sale_refund' JE already exists for this refund row.
  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'sale_refund' AND reference_id = NEW.id
    LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Fiscal guard.
  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_net := NEW.total - NEW.tax_refunded;

  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  SELECT order_number INTO v_order_number FROM orders WHERE id = NEW.order_id;

  v_entry_no := next_journal_entry_number(NEW.created_at::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    NEW.created_at::date,
    'Refund ' || NEW.refund_number || ' (order ' || COALESCE(v_order_number, '?') || ')',
    'sale_refund',
    NEW.id,
    'posted',
    NEW.total,
    NEW.total,
    NEW.refunded_by
  ) RETURNING id INTO v_je_id;

  -- DR side : reverse the sale (sales debited back, PB1 debited back)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_sales_id, v_net,            0, 'Sales revenue (refund)'),
    (v_je_id, v_pb1_id,   NEW.tax_refunded, 0, 'PB1 payable (refund)');

  -- CR side : credit per refund_payment row, routed through mapping by method.
  FOR v_pay IN SELECT method, amount FROM refund_payments WHERE refund_id = NEW.id LOOP
    v_mapping_key := CASE v_pay.method::TEXT
      WHEN 'cash'        THEN 'SALE_PAYMENT_CASH'
      WHEN 'qris'        THEN 'SALE_PAYMENT_QRIS'
      WHEN 'debit_card'  THEN 'SALE_PAYMENT_DEBIT'
      WHEN 'credit_card' THEN 'SALE_PAYMENT_CREDIT_CARD'
      ELSE 'SALE_PAYMENT_CASH'  -- safe fallback
    END;
    v_cash_id := resolve_mapping_account(v_mapping_key);

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cash_id, 0, v_pay.amount,
      'Cash refund (' || v_pay.method::TEXT || ')');
  END LOOP;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_create_je_for_refund
  AFTER INSERT ON refunds
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_je_for_refund();

COMMENT ON FUNCTION fn_create_je_for_refund() IS
  'D16/D11/D12/D14 refactor. Resolves accounts via accounting_mappings (per-method '
  'SALE_PAYMENT_*), generates JE number via helper, guards fiscal period, idempotent '
  'via pre-SELECT on (sale_refund, refund_id). reference_type=sale_refund (canonical).';
