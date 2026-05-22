-- 20260603000014_bump_create_sale_journal_entry_split_by_payment_method.sql
-- Session 26 / Wave 1.E / migration _014 :
--   Refactor create_sale_journal_entry pour splitter le DR par méthode de
--   paiement via boucle sur order_payments (au lieu d agréger sur 1110).
--
-- Closes audit finding F-S26-AC-02.
--
-- Avant : tous les paiements (cash/qris/card/edc) agrégés en DR sur 1110 Cash.
--   Conséquence : Balance Sheet gonflait Cash artificiellement, comptes
--   clearing 1115 QRIS / 1116 Card / 1112 Bank restaient vides.
-- Après : boucle sur order_payments + 1 DR par méthode routé via mapping key
--   (pattern miroir de fn_create_je_for_refund qui le fait déjà sur les refunds).
--
-- Méthodes supportées (mapping keys déjà seedés S13) :
--   cash         → SALE_PAYMENT_CASH         (1110 Cash on hand)
--   qris         → SALE_PAYMENT_QRIS         (1115 QRIS Clearing)
--   debit_card   → SALE_PAYMENT_DEBIT        (1116 Card Clearing)
--   credit_card  → SALE_PAYMENT_CREDIT_CARD  (1116 Card Clearing)
--   transfer     → SALE_PAYMENT_CASH (fallback — peut être enrichi S26+)
--
-- Le path 'voided' (reversal) bouche aussi en miroir : 1 CR par méthode.

DROP TRIGGER IF EXISTS trg_create_sale_journal_entry_ins ON orders;
DROP TRIGGER IF EXISTS trg_create_sale_journal_entry_upd ON orders;

CREATE OR REPLACE FUNCTION create_sale_journal_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rate      NUMERIC;
  v_vat       DECIMAL(14,2);
  v_net       DECIMAL(14,2);
  v_je_id     UUID;
  v_existing  UUID;
  v_entry_no  TEXT;
  v_sales_id  UUID;
  v_pb1_id    UUID;
  v_pay       RECORD;
  v_mapping   TEXT;
  v_acc_id    UUID;
BEGIN
  IF NEW.status NOT IN ('paid', 'voided') THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_rate     := current_pb1_rate();
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := round_idr(NEW.total * v_rate / (1 + v_rate));
    v_net := NEW.total - v_vat;

    v_entry_no := next_journal_entry_number(NEW.created_at::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date,
      'Sale ' || NEW.order_number, 'sale', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    -- CR side : Sales revenue + PB1 payable (unchanged from 1.B)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, 0, v_net, 'Sales revenue (net of PB1)'),
      (v_je_id, v_pb1_id,   0, v_vat, 'PB1 payable (rate=' || (v_rate * 100)::TEXT || '%)');

    -- DR side : F-S26-AC-02 — split per order_payments.method
    -- Pattern mirroir de fn_create_je_for_refund (migration 20260517000013).
    FOR v_pay IN
      SELECT method::TEXT AS method, amount
        FROM order_payments
        WHERE order_id = NEW.id
        ORDER BY paid_at ASC
    LOOP
      v_mapping := CASE v_pay.method
        WHEN 'cash'        THEN 'SALE_PAYMENT_CASH'
        WHEN 'qris'        THEN 'SALE_PAYMENT_QRIS'
        WHEN 'debit_card'  THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'credit_card' THEN 'SALE_PAYMENT_CREDIT_CARD'
        ELSE 'SALE_PAYMENT_CASH'
      END;
      v_acc_id := resolve_mapping_account(v_mapping);

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, v_pay.amount, 0,
          'Payment receipt (' || v_pay.method || ')');
    END LOOP;

    -- Edge case : order paid with no order_payments rows (legacy data, B2B credit).
    -- Fall back to single DR on SALE_PAYMENT_CASH to keep JE balanced.
    IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = NEW.id) THEN
      v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, NEW.total, 0,
          'Payment receipt (no order_payments rows — fallback to cash)');
    END IF;

  ELSIF NEW.status = 'voided' AND OLD.status = 'paid' THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale_void' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := round_idr(NEW.total * v_rate / (1 + v_rate));
    v_net := NEW.total - v_vat;

    v_entry_no := next_journal_entry_number(NEW.created_at::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date,
      'REVERSAL ' || NEW.order_number, 'sale_void', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    -- DR side (reversal) : reverse sales + PB1
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, v_net, 0, 'Sales revenue (reversal)'),
      (v_je_id, v_pb1_id,   v_vat, 0, 'PB1 payable (reversal)');

    -- CR side (reversal) : F-S26-AC-02 — split per order_payments.method
    FOR v_pay IN
      SELECT method::TEXT AS method, amount
        FROM order_payments
        WHERE order_id = NEW.id
        ORDER BY paid_at ASC
    LOOP
      v_mapping := CASE v_pay.method
        WHEN 'cash'        THEN 'SALE_PAYMENT_CASH'
        WHEN 'qris'        THEN 'SALE_PAYMENT_QRIS'
        WHEN 'debit_card'  THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'credit_card' THEN 'SALE_PAYMENT_CREDIT_CARD'
        ELSE 'SALE_PAYMENT_CASH'
      END;
      v_acc_id := resolve_mapping_account(v_mapping);

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, 0, v_pay.amount,
          'Payment reversal (' || v_pay.method || ')');
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = NEW.id) THEN
      v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, 0, NEW.total,
          'Payment reversal (no order_payments rows — fallback to cash)');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_sale_journal_entry_ins
  AFTER INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'paid')
  EXECUTE FUNCTION create_sale_journal_entry();

CREATE TRIGGER trg_create_sale_journal_entry_upd
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (
    (NEW.status = 'paid'   AND OLD.status IS DISTINCT FROM 'paid')
    OR (NEW.status = 'voided' AND OLD.status IS DISTINCT FROM 'voided')
  )
  EXECUTE FUNCTION create_sale_journal_entry();

COMMENT ON FUNCTION create_sale_journal_entry() IS
  'F-S26-AC-01 (1.B) PB1 dynamic + F-S26-AC-02 (1.E) split DR par order_payments.method. '
  'Pattern miroir de fn_create_je_for_refund. Edge case : si pas de row order_payments '
  '(B2B credit, legacy), fallback single DR SALE_PAYMENT_CASH pour JE balanced.';
