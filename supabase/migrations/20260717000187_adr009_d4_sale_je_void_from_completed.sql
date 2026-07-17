-- 20260717000187_adr009_d4_sale_je_void_from_completed.sql
-- ADR-009 déc. 4 — un void depuis `completed` doit produire la même écriture
-- inverse (sale_void) qu'un void depuis `paid`. La WHEN du trigger UPDATE
-- (trg_create_sale_journal_entry_upd : NEW voided AND OLD ≠ voided) laisse déjà
-- passer completed→voided, mais la branche void du CORPS exigeait
-- `OLD.status = 'paid'` → la réversion JE aurait été silencieusement sautée
-- (vente comptabilisée jamais reversée = P&L faux).
--
-- Corps LIVE (pg_get_functiondef, 2026-07-17). SEUL changement :
-- `ELSIF NEW.status = 'voided' AND OLD.status = 'paid'` →
-- `OLD.status IN ('paid', 'completed')`.
-- Invariants préservés : check_fiscal_period_open, current_pb1_rate(),
-- resolve_mapping_account, dédoublonnage par reference_type/reference_id,
-- fallback cash audité. Les triggers (WHEN clauses) ne changent pas :
-- paid→completed ne re-déclenche NI la branche vente NI la branche void.

CREATE OR REPLACE FUNCTION public.create_sale_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NEW.is_historical_import THEN
    RETURN NEW;
  END IF;

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

    v_vat := COALESCE(NEW.tax_amount, 0);
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

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, 0, v_net, 'Sales revenue (net of PB1)');

    IF v_vat > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_pb1_id, 0, v_vat, 'PB1 payable (rate=' || (v_rate * 100)::TEXT || '%)');
    END IF;

    FOR v_pay IN
      SELECT method::TEXT AS method, amount
        FROM order_payments
        WHERE order_id = NEW.id
        ORDER BY paid_at ASC
    LOOP
      v_mapping := CASE v_pay.method
        WHEN 'cash'         THEN 'SALE_PAYMENT_CASH'
        WHEN 'qris'         THEN 'SALE_PAYMENT_QRIS'
        WHEN 'card'         THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'edc'          THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'transfer'     THEN 'SALE_PAYMENT_TRANSFER'
        WHEN 'store_credit' THEN 'SALE_PAYMENT_CASH'
        ELSE 'SALE_PAYMENT_CASH'
      END;
      v_acc_id := resolve_mapping_account(v_mapping);

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, v_pay.amount, 0,
          'Payment receipt (' || v_pay.method || ')');
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = NEW.id) THEN
      v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, NEW.total, 0,
          'Payment receipt (no order_payments rows — fallback to cash)');
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (NEW.served_by, 'je.payment_fallback_cash', 'orders', NEW.id,
                jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total,
                                   'direction', 'sale'));
    END IF;

  ELSIF NEW.status = 'voided' AND OLD.status IN ('paid', 'completed') THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale_void' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := COALESCE(NEW.tax_amount, 0);
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

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, v_net, 0, 'Sales revenue (reversal)');

    IF v_vat > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_pb1_id, v_vat, 0, 'PB1 payable (reversal)');
    END IF;

    FOR v_pay IN
      SELECT method::TEXT AS method, amount
        FROM order_payments
        WHERE order_id = NEW.id
        ORDER BY paid_at ASC
    LOOP
      v_mapping := CASE v_pay.method
        WHEN 'cash'         THEN 'SALE_PAYMENT_CASH'
        WHEN 'qris'         THEN 'SALE_PAYMENT_QRIS'
        WHEN 'card'         THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'edc'          THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'transfer'     THEN 'SALE_PAYMENT_TRANSFER'
        WHEN 'store_credit' THEN 'SALE_PAYMENT_CASH'
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
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (NEW.served_by, 'je.payment_fallback_cash', 'orders', NEW.id,
                jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total,
                                   'direction', 'reversal'));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.create_sale_journal_entry() IS
  'Trigger JE ventes : écriture sale au passage paid, réversion sale_void au void depuis paid OU completed (ADR-009 déc. 4). Idempotent par reference_type/reference_id, fiscal-gated.';
