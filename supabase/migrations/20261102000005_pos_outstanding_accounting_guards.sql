-- Émetteur production relu avec pg_get_functiondef ; ne pas doubler la vente au règlement.
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
  v_acc_id    UUID;
BEGIN
  IF NEW.financial_import_document_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.is_historical_import THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('paid', 'voided') THEN
    RETURN NEW;
  END IF;

  -- B2B guard: revenue for B2B orders is carried by the 'b2b_order' JE
  -- (DR 1132 / CR 4131) emitted by create_b2b_order at creation time, and
  -- reversed/adjusted by cancel_b2b_order's own books. record_b2b_payment
  -- flips status to 'paid' WITHOUT any order_payments row, which would
  -- otherwise trip the no-payments fallback below and double the revenue.
  -- This trigger must not emit or block anything for a B2B order.
  IF NEW.order_type = 'b2b'
     OR EXISTS (SELECT 1 FROM journal_entries
                  WHERE reference_type = 'b2b_order' AND reference_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Une vente différée a déjà sa JE ; son règlement éteint la créance.
  IF NEW.outstanding_at IS NOT NULL AND NEW.status = 'paid' THEN RETURN NEW; END IF;
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
      v_acc_id := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method));

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
      v_acc_id := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method));

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
    IF COALESCE(NEW.loyalty_redemption_amount,0)>0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id,account_id,debit,credit,description) VALUES
        (v_je_id,resolve_mapping_account('SALE_DISCOUNT'),NEW.loyalty_redemption_amount,0,'Loyalty redemption voided -- DR discount'),
        (v_je_id,resolve_mapping_account('LOYALTY_LIABILITY'),0,NEW.loyalty_redemption_amount,'Loyalty redemption voided -- CR liability');
      UPDATE journal_entries SET total_debit=total_debit+NEW.loyalty_redemption_amount,
        total_credit=total_credit+NEW.loyalty_redemption_amount WHERE id=v_je_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE FUNCTION public._guard_pos_outstanding_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_order uuid;
BEGIN
  IF TG_TABLE_NAME='order_items' THEN
    v_order:=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
    IF EXISTS(SELECT 1 FROM orders WHERE id=v_order AND outstanding_at IS NOT NULL) THEN
      IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'outstanding_invoice_sealed' USING ERRCODE='23514'; END IF;
      IF (to_jsonb(NEW)-ARRAY['kitchen_status','is_locked','sent_to_kitchen_at','updated_at'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['kitchen_status','is_locked','sent_to_kitchen_at','updated_at']) THEN
        RAISE EXCEPTION 'outstanding_invoice_sealed' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF OLD.outstanding_at IS NOT NULL THEN
    IF (NEW.total,NEW.subtotal,NEW.tax_amount,NEW.customer_id,NEW.session_id,NEW.order_type,NEW.outstanding_at,
        NEW.discount_amount,NEW.loyalty_redemption_amount)
      IS DISTINCT FROM (OLD.total,OLD.subtotal,OLD.tax_amount,OLD.customer_id,OLD.session_id,OLD.order_type,OLD.outstanding_at,
        OLD.discount_amount,OLD.loyalty_redemption_amount) THEN
      RAISE EXCEPTION 'outstanding_invoice_sealed' USING ERRCODE='23514'; END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
      AND NOT (OLD.status='paid' AND NEW.status='completed')
      AND coalesce(current_setting('breakery.outstanding_settlement',true),'')<>'true' THEN
      RAISE EXCEPTION 'outstanding_requires_settlement' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public._guard_pos_outstanding_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_pos_outstanding_order BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._guard_pos_outstanding_v1();
CREATE TRIGGER guard_pos_outstanding_items BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public._guard_pos_outstanding_v1();
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
