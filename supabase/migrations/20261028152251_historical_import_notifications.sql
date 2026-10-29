CREATE OR REPLACE FUNCTION public._trg_notify_b2b_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email TEXT;
  v_name  TEXT;
BEGIN
  IF public._historical_import_context_v1() IS NOT NULL THEN RETURN NULL; END IF;
  BEGIN
    SELECT c.email, c.name INTO v_email, v_name
    FROM customers c
    WHERE c.id = NEW.customer_id
      AND c.deleted_at IS NULL
      AND c.email IS NOT NULL
      AND length(trim(c.email)) > 0;

    IF FOUND THEN
      PERFORM _enqueue_notification_system_v1(
        'payment_received',
        v_email,
        jsonb_build_object(
          'order_number',   NEW.payment_number,
          'customer_name',  COALESCE(v_name, 'customer'),
          'amount',         NEW.amount,
          'payment_method', NEW.method::text
        ),
        extensions.uuid_generate_v5(
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
          'b2b-payment-' || NEW.id::text
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_trg_notify_b2b_payment skipped for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._trg_notify_low_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_alert TEXT;
BEGIN
  IF public._historical_import_context_v1() IS NOT NULL THEN RETURN NULL; END IF;
  BEGIN
    SELECT alert_email INTO v_alert FROM business_config WHERE id = 1;
    IF v_alert IS NULL OR length(trim(v_alert)) = 0 THEN RETURN NULL; END IF;

    PERFORM _enqueue_notification_system_v1(
      'low_stock_alert',
      v_alert,
      jsonb_build_object(
        'product_name',  NEW.name,
        'current_stock', NEW.current_stock,
        'threshold',     NEW.min_stock_threshold,
        'unit',          NEW.unit
      ),
      extensions.uuid_generate_v5(
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
        'low-stock-' || NEW.id::text || '-' || current_date::text
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_trg_notify_low_stock skipped for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._trg_notify_order_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email TEXT;
  v_name  TEXT;
BEGIN
  IF NEW.financial_import_document_id IS NOT NULL THEN RETURN NULL; END IF;
  BEGIN
    SELECT c.email, c.name INTO v_email, v_name
    FROM customers c
    WHERE c.id = NEW.customer_id
      AND c.deleted_at IS NULL
      AND c.email IS NOT NULL
      AND length(trim(c.email)) > 0;

    IF FOUND THEN
      PERFORM _enqueue_notification_system_v1(
        'order_complete',
        v_email,
        jsonb_build_object(
          'order_number',  NEW.order_number,
          'customer_name', COALESCE(v_name, 'customer'),
          'total',         NEW.total
        ),
        extensions.uuid_generate_v5(
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
          'order-complete-' || NEW.id::text
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_trg_notify_order_complete skipped for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._trg_notify_po_received()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_alert    TEXT;
  v_supplier TEXT;
BEGIN
  IF NEW.financial_import_document_id IS NOT NULL THEN RETURN NULL; END IF;
  BEGIN
    SELECT alert_email INTO v_alert FROM business_config WHERE id = 1;
    IF v_alert IS NULL OR length(trim(v_alert)) = 0 THEN RETURN NULL; END IF;

    SELECT s.name INTO v_supplier FROM suppliers s WHERE s.id = NEW.supplier_id;

    PERFORM _enqueue_notification_system_v1(
      'po_received',
      v_alert,
      jsonb_build_object(
        'po_number',     NEW.po_number,
        'supplier_name', COALESCE(v_supplier, '—'),
        'total',         NEW.total_amount,
        'received_at',   now()::text
      ),
      extensions.uuid_generate_v5(
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
        'po-received-' || NEW.id::text
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_trg_notify_po_received skipped for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._trg_try_complete_on_item_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS(SELECT 1 FROM public.orders WHERE id=NEW.order_id AND financial_import_document_id IS NOT NULL) THEN RETURN NULL; END IF;
  PERFORM public._try_complete_order_v1(NEW.order_id);
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public._trg_try_complete_on_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.financial_import_document_id IS NOT NULL THEN RETURN NULL; END IF;
  PERFORM public._try_complete_order_v1(NEW.id);
  RETURN NULL;
END $function$
;
