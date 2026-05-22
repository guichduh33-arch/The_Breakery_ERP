-- 20260603000011_bump_create_sale_journal_entry_pb1_dynamic.sql
-- Session 26 / Wave 1.B / migration _011 :
--   Refactor create_sale_journal_entry pour lire current_pb1_rate() au lieu
--   de hardcoded 10/110.
--
-- Closes audit finding F-S26-AC-01.
--
-- Pattern : CLAUDE.md exempt les triggers de versioning monotonic — on fait
-- DROP TRIGGER + CREATE OR REPLACE FUNCTION (signature identique : pas de
-- nouveaux args, body interne refactoré).
--
-- Note : cette migration NE traite PAS le split par order_payments.method
-- (F-S26-AC-02 → Wave 1.E). Le compte cash reste agrégé sur SALE_PAYMENT_CASH
-- pour l'instant ; phase 1.E bumpera à nouveau le trigger.

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
  v_cash_id   UUID;
  v_sales_id  UUID;
  v_pb1_id    UUID;
BEGIN
  IF NEW.status NOT IN ('paid', 'voided') THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_rate := current_pb1_rate();  -- F-S26-AC-01 : dynamic PB1 rate from business_config

  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := round_idr(NEW.total * v_rate / (1 + v_rate));
    v_net := NEW.total - v_vat;

    v_cash_id  := resolve_mapping_account('SALE_PAYMENT_CASH');
    v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
    v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

    v_entry_no := next_journal_entry_number(NEW.created_at::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date,
      'Sale ' || NEW.order_number, 'sale', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_cash_id,  NEW.total, 0, 'Cash receipt'),
      (v_je_id, v_sales_id, 0, v_net,     'Sales revenue (net of PB1)'),
      (v_je_id, v_pb1_id,   0, v_vat,     'PB1 payable (rate=' || (v_rate * 100)::TEXT || '%)');

  ELSIF NEW.status = 'voided' AND OLD.status = 'paid' THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale_void' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := round_idr(NEW.total * v_rate / (1 + v_rate));
    v_net := NEW.total - v_vat;

    v_cash_id  := resolve_mapping_account('SALE_PAYMENT_CASH');
    v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
    v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

    v_entry_no := next_journal_entry_number(NEW.created_at::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date,
      'REVERSAL ' || NEW.order_number, 'sale_void', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, v_net,     0, 'Sales revenue (reversal)'),
      (v_je_id, v_pb1_id,   v_vat,     0, 'PB1 payable (reversal)'),
      (v_je_id, v_cash_id,  0, NEW.total, 'Cash (reversal)');
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
  'F-S26-AC-01 : PB1 rate dynamic via current_pb1_rate() (was hardcoded 10/110). '
  'Idempotent via pre-SELECT on (reference_type, reference_id). Period guard via '
  'check_fiscal_period_open. Sale reference_type=sale ; void=sale_void. '
  'Wave 1.E ajoutera split par order_payments.method (F-S26-AC-02).';
