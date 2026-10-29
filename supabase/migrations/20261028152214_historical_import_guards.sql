-- Protection persistante : les money-path ordinaires ne savent pas contrepasser
-- le registre de reprise ; ils refusent ces seules lignes et leurs enfants.
CREATE FUNCTION public._historical_import_entity_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_row jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 v_old jsonb:=CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 v_document uuid; v_run uuid:=_historical_import_context_v1(); v_parent uuid;
BEGIN
 IF TG_TABLE_NAME IN ('orders','purchase_orders') THEN
  v_document:=coalesce((v_old->>'financial_import_document_id')::uuid,(v_row->>'financial_import_document_id')::uuid);
  IF TG_OP='UPDATE' AND v_old->>'financial_import_document_id' IS DISTINCT FROM v_row->>'financial_import_document_id' THEN
   RAISE EXCEPTION 'financial_import_marker_immutable' USING ERRCODE='P0003';
  END IF;
 ELSIF TG_TABLE_NAME IN ('order_items','order_payments','refunds') THEN
  SELECT financial_import_document_id INTO v_document FROM orders WHERE id=(v_row->>'order_id')::uuid;
  IF v_document IS NULL THEN SELECT financial_import_document_id INTO v_document FROM orders WHERE id=(v_old->>'order_id')::uuid; END IF;
 ELSIF TG_TABLE_NAME IN ('purchase_order_items','goods_receipt_notes','purchase_payments') THEN
  SELECT financial_import_document_id INTO v_document FROM purchase_orders
   WHERE id=coalesce((v_row->>'po_id')::uuid,(v_row->>'purchase_order_id')::uuid);
  IF v_document IS NULL THEN SELECT financial_import_document_id INTO v_document FROM purchase_orders
   WHERE id=coalesce((v_old->>'po_id')::uuid,(v_old->>'purchase_order_id')::uuid); END IF;
 ELSIF TG_TABLE_NAME='b2b_payment_allocations' THEN
  SELECT financial_import_document_id INTO v_document FROM orders WHERE id=(v_row->>'invoice_id')::uuid;
  IF v_document IS NULL THEN SELECT financial_import_document_id INTO v_document FROM orders WHERE id=(v_old->>'invoice_id')::uuid; END IF;
 ELSIF TG_TABLE_NAME='b2b_payments' THEN
  SELECT a.document_id INTO v_document FROM historical_import_allocations a WHERE native_payment_id=(v_row->>'id')::uuid LIMIT 1;
 END IF;
 IF v_document IS NOT NULL THEN
  IF TG_OP='DELETE' OR v_run IS NULL OR NOT EXISTS(
   SELECT 1 FROM historical_import_documents d JOIN historical_import_runs r ON r.id=v_run
   WHERE d.id=v_document AND d.kind=r.kind AND d.source_system=r.source_system) THEN
   RAISE EXCEPTION 'financial_import_requires_dedicated_workflow' USING ERRCODE='P0003';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','order_items','order_payments','refunds','purchase_orders',
  'purchase_order_items','goods_receipt_notes','purchase_payments','b2b_payments','b2b_payment_allocations'] LOOP
  EXECUTE format('CREATE TRIGGER financial_import_entity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._historical_import_entity_guard_v1()',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._historical_import_entity_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.create_purchase_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inv_id          UUID;
  v_ap_id           UUID;
  v_je_id           UUID;
  v_existing_je     UUID;
  v_entry_no        TEXT;
  v_subtotal        DECIMAL(14,2);
  v_vat             DECIMAL(14,2);
  v_total           DECIMAL(14,2);
  v_inv_debit       DECIMAL(14,2);
  v_payment_terms   TEXT;
  v_grn_date        DATE;
  v_auto_pay_idem   UUID;
  v_auto_pay_exists BOOLEAN := FALSE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchase_orders WHERE id=NEW.po_id AND financial_import_document_id IS NOT NULL) THEN RETURN NEW; END IF;
  SELECT id INTO v_existing_je FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = NEW.id
    LIMIT 1;
  IF v_existing_je IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_subtotal      := COALESCE(NEW.subtotal,      0);
  v_vat           := COALESCE(NEW.vat_amount,    0);
  v_total         := COALESCE(NEW.total,         0);
  v_payment_terms := COALESCE(NEW.payment_terms, 'credit');
  v_grn_date      := COALESCE(NEW.received_date, NEW.created_at::date);

  PERFORM check_fiscal_period_open(v_grn_date);

  v_inv_id := resolve_mapping_account('INVENTORY_GENERAL');
  v_ap_id  := resolve_mapping_account('PURCHASE_PAYABLE');

  v_inv_debit := v_subtotal + v_vat;

  v_entry_no := next_journal_entry_number(v_grn_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description,
    reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    v_grn_date,
    'Purchase receipt ' || COALESCE(NEW.grn_number, NEW.id::text),
    'purchase', NEW.id,
    'posted', v_total, v_total,
    NEW.received_by
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_inv_id, v_inv_debit, 0,
      CASE WHEN v_vat > 0
        THEN 'Inventory received (incl. non-recoverable PPN ' || v_vat::TEXT || ')'
        ELSE 'Inventory received'
      END);

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_ap_id, 0, v_total, 'AP recorded at receipt');

  IF v_payment_terms = 'cash' THEN
    v_auto_pay_idem := md5('auto_cash_pay:' || NEW.id::text)::uuid;

    SELECT EXISTS (
      SELECT 1 FROM purchase_payments WHERE idempotency_key = v_auto_pay_idem
    ) INTO v_auto_pay_exists;

    IF NOT v_auto_pay_exists THEN
      PERFORM _record_po_payment_internal(
        p_po_id           := NEW.po_id,
        p_amount          := v_total,
        p_method          := 'cash',
        p_reference       := 'Auto-payment at receipt: ' || COALESCE(NEW.grn_number, NEW.id::text),
        p_idempotency_key := v_auto_pay_idem,
        p_actor           := NEW.received_by
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

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

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
