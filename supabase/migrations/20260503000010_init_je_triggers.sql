-- 20260503000010_init_je_triggers.sql
-- Auto-create journal entry when an order is marked paid (or voided).
-- PB1 = ROUND(total * 10/110) (tax-inclusive, extracted).

CREATE OR REPLACE FUNCTION create_sale_journal_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vat       DECIMAL(12,2);
  v_net       DECIMAL(12,2);
  v_je_id     UUID;
  v_entry_no  TEXT;
  v_cash_id   UUID;
  v_sales_id  UUID;
  v_pb1_id    UUID;
BEGIN
  IF NEW.status NOT IN ('paid','voided') THEN
    RETURN NEW;
  END IF;

  v_vat := round_idr(NEW.total * 10 / 110);
  v_net := NEW.total - v_vat;

  SELECT id INTO v_cash_id  FROM accounts WHERE code = '1110' AND is_active;
  SELECT id INTO v_sales_id FROM accounts WHERE code = '4100' AND is_active;
  SELECT id INTO v_pb1_id   FROM accounts WHERE code = '2110' AND is_active;

  IF v_cash_id IS NULL OR v_sales_id IS NULL OR v_pb1_id IS NULL THEN
    RAISE NOTICE 'create_sale_journal_entry: missing accounts (1110/%, 4100/%, 2110/%)',
      v_cash_id, v_sales_id, v_pb1_id;
    RETURN NEW;
  END IF;

  v_entry_no := 'JE-' || to_char(NEW.created_at, 'YYYYMMDD') || '-' || NEW.order_number;

  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date, 'Sale ' || NEW.order_number, 'sale', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_cash_id,  NEW.total, 0, 'Cash receipt'),
      (v_je_id, v_sales_id, 0, v_net,     'Sales revenue (net of PB1)'),
      (v_je_id, v_pb1_id,   0, v_vat,     'PB1 payable (10%)');

  ELSIF NEW.status = 'voided' AND OLD.status = 'paid' THEN
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no || '-VOID', NEW.created_at::date, 'REVERSAL ' || NEW.order_number, 'void', NEW.id,
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

-- Le RPC complete_order_with_payment fait INSERT direct avec status='paid',
-- donc on a besoin du trigger AFTER INSERT (pas seulement AFTER UPDATE).
CREATE TRIGGER trg_create_sale_journal_entry_ins
  AFTER INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'paid')
  EXECUTE FUNCTION create_sale_journal_entry();

CREATE TRIGGER trg_create_sale_journal_entry_upd
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (
    (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
    OR (NEW.status = 'voided' AND OLD.status IS DISTINCT FROM 'voided')
  )
  EXECUTE FUNCTION create_sale_journal_entry();

COMMENT ON FUNCTION create_sale_journal_entry() IS
  'Auto JE on order paid/voided. PB1 10% extracted from inclusive total. DR Cash / CR Sales + CR PB1.';
