-- 20260723000208_ewallet_je_qris_mapping.sql
-- ADR-006 déc. 9 (lot B) — mapping comptable des e-wallets : gopay/ovo/dana
-- règlent sur le compte QRIS (SALE_PAYMENT_QRIS), décision Mamat 2026-07-23.
-- Sans ces branches, le CASE tombait en fallback SALE_PAYMENT_CASH (faux).
--
-- Corps repris du live (pg_get_functiondef, 2026-07-23) — seules les branches
-- WHEN 'gopay'/'ovo'/'dana' sont ajoutées (2 CASE dans le trigger vente,
-- 1 CASE dans le trigger refund). Fonctions trigger non versionnées →
-- CREATE OR REPLACE (le versioning _vN ne s'applique qu'aux RPCs publiées).
-- NB : les branches legacy 'debit_card'/'credit_card' du CASE refund sont
-- conservées telles quelles (hors périmètre — jamais des valeurs de l'enum).

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
        -- lot B : e-wallets réglés comme QRIS (décision 2026-07-23)
        WHEN 'gopay'        THEN 'SALE_PAYMENT_QRIS'
        WHEN 'ovo'          THEN 'SALE_PAYMENT_QRIS'
        WHEN 'dana'         THEN 'SALE_PAYMENT_QRIS'
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
        -- lot B : e-wallets réglés comme QRIS (décision 2026-07-23)
        WHEN 'gopay'        THEN 'SALE_PAYMENT_QRIS'
        WHEN 'ovo'          THEN 'SALE_PAYMENT_QRIS'
        WHEN 'dana'         THEN 'SALE_PAYMENT_QRIS'
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
      -- lot B : e-wallets réglés comme QRIS (décision 2026-07-23)
      WHEN 'gopay'       THEN 'SALE_PAYMENT_QRIS'
      WHEN 'ovo'         THEN 'SALE_PAYMENT_QRIS'
      WHEN 'dana'        THEN 'SALE_PAYMENT_QRIS'
      ELSE 'SALE_PAYMENT_CASH'
    END;
    v_cash_id := resolve_mapping_account(v_mapping_key);
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cash_id, 0, v_pay.amount,
      'Cash refund (' || v_pay.method::TEXT || ')');
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM refund_payments WHERE refund_id = NEW.id) THEN
    v_cash_id := resolve_mapping_account('SALE_PAYMENT_CASH');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cash_id, 0, NEW.total, 'Cash refund (fallback — no tender recorded)');
  END IF;

  RETURN NEW;
END $function$;
