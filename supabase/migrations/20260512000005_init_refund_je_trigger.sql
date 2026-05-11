-- 20260512000005_init_refund_je_trigger.sql
-- Session 10 — auto JE creation on refund insert.
-- DR Sales (4100) for net portion + DR PB1 (2110) for tax_refunded + CR Cash (1110) per refund_payments rows.
-- Mirrors create_sale_journal_entry pattern (session 3) but inverted.
--
-- IMPORTANT: trigger fires AFTER INSERT on refunds. The RPCs (refund_order_rpc, void_order_rpc)
-- insert refunds row first, THEN refund_payments rows. Since both are in the same transaction,
-- the trigger's SELECT FROM refund_payments WHERE refund_id = NEW.id sees the rows.
--
-- IMPORTANT: void_order_rpc updates orders.status to 'voided', firing the session 3 trigger
-- (create_sale_journal_entry) which writes JE-{order_number}-VOID. Both JEs (this one and the
-- session 3 reversal) are accounting-equivalent. Reports session 14 will dedupe by reference_type
-- (prefer 'refund' over 'void' for full-void rows where both exist). Documented in spec §8.

CREATE OR REPLACE FUNCTION fn_create_je_for_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_je_id        UUID;
  v_entry_no     TEXT;
  v_cash_id      UUID;
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_net          DECIMAL(14,2);
  v_pay          RECORD;
  v_order_number TEXT;
BEGIN
  v_net := NEW.total - NEW.tax_refunded;

  SELECT id INTO v_cash_id  FROM accounts WHERE code = '1110' AND is_active;
  SELECT id INTO v_sales_id FROM accounts WHERE code = '4100' AND is_active;
  SELECT id INTO v_pb1_id   FROM accounts WHERE code = '2110' AND is_active;

  IF v_cash_id IS NULL OR v_sales_id IS NULL OR v_pb1_id IS NULL THEN
    RAISE NOTICE 'fn_create_je_for_refund: missing accounts (1110/%, 4100/%, 2110/%)',
      v_cash_id, v_sales_id, v_pb1_id;
    RETURN NEW;
  END IF;

  SELECT order_number INTO v_order_number FROM orders WHERE id = NEW.order_id;

  v_entry_no := 'JE-REF-' || NEW.refund_number;

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    NEW.created_at::date,
    'Refund ' || NEW.refund_number || ' (order ' || COALESCE(v_order_number, '?') || ')',
    'refund',
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

  -- CR side : credit the cash account once per refund_payment row.
  -- v1: all methods route to '1110' Cash (multi-method posting deferred to reports session 14).
  FOR v_pay IN SELECT method, amount FROM refund_payments WHERE refund_id = NEW.id LOOP
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
  'Session 10: auto JE on refund insert. DR Sales (net) + DR PB1 (tax) / CR Cash per refund_payments. v1: all methods → 1110.';
