-- 20260517000010_refactor_create_sale_journal_entry.sql
-- Session 13 / Phase 1.A / migration 10-001 :
--   Refactor create_sale_journal_entry trigger to use accounting_mappings +
--   next_journal_entry_number + check_fiscal_period_open + idempotency pre-SELECT.
--
-- Before : literal codes '1110'/'4100'/'2110', entry_number from
--          'JE-' || YYYYMMDD || '-' || order_number (collision-prone if order #
--          collides intraday), no fiscal guard, no explicit idempotency check
--          (the AFTER INSERT + AFTER UPDATE pair could double-fire on retry).
-- After  : resolve_mapping_account() lookups, JE-YYYYMMDD-XXXX from helper,
--          period guard, idempotency SELECT.
--
-- The trigger is inline (DROP+CREATE OR REPLACE), not a versioned RPC ; CLAUDE.md
-- exempts triggers from monotonic RPC versioning. The trigger NAMES
-- (trg_create_sale_journal_entry_ins/upd) stay the same to keep operational
-- continuity, but the function body is rewritten end-to-end.
--
-- Decision : D11 (mapping), D12 (period), D14 (entry-number helper).

-- Drop the legacy trigger pair first (CASCADE not needed — no dependants).
DROP TRIGGER IF EXISTS trg_create_sale_journal_entry_ins ON orders;
DROP TRIGGER IF EXISTS trg_create_sale_journal_entry_upd ON orders;
DROP FUNCTION IF EXISTS create_sale_journal_entry();

CREATE OR REPLACE FUNCTION create_sale_journal_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_vat       DECIMAL(14,2);
  v_net       DECIMAL(14,2);
  v_je_id     UUID;
  v_existing  UUID;
  v_entry_no  TEXT;
  v_cash_id   UUID;
  v_sales_id  UUID;
  v_pb1_id    UUID;
  v_disc_id   UUID;
BEGIN
  IF NEW.status NOT IN ('paid', 'voided') THEN
    RETURN NEW;
  END IF;

  -- Fiscal period guard — RAISE P0004 if entry_date falls in closed/locked period.
  PERFORM check_fiscal_period_open(NEW.created_at::date);

  -- ---------------------------------------------------------------------------
  -- PAID path : DR Cash / CR Revenue + CR PB1 + (optional CR/DR Loyalty)
  -- ---------------------------------------------------------------------------
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    -- Idempotency: skip if a 'sale' JE already exists for this order.
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := round_idr(NEW.total * 10 / 110);
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
      (v_je_id, v_pb1_id,   0, v_vat,     'PB1 payable (10%)');

  -- ---------------------------------------------------------------------------
  -- VOIDED path : reversal — reuse the same canonical numbering but reference_type='sale_void'.
  -- ---------------------------------------------------------------------------
  ELSIF NEW.status = 'voided' AND OLD.status = 'paid' THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale_void' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := round_idr(NEW.total * 10 / 110);
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
  'D11/D12/D14 refactor. Resolves accounts via accounting_mappings, generates JE '
  'number via next_journal_entry_number, guards fiscal period, idempotent via '
  'pre-SELECT on (reference_type, reference_id). Sale reference_type=sale ; void=sale_void.';

-- Note : the canonical (reference_type, reference_id, movement_type-discriminator)
-- UNIQUE constraint is defined in migration 20260517000023 alongside the
-- stock-movement JE trigger (single source of truth for the index). The
-- pre-SELECT above is the runtime guard ; the UNIQUE constraint is the
-- race-condition belt-and-braces.
