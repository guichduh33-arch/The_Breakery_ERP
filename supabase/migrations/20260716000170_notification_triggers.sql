-- 20260716000170_notification_triggers.sql
-- Settings §6.A (audit 2026-07-16) — wire the seeded notification templates to
-- their real business events. Until now the only producer was the birthday
-- cron; low_stock_alert / po_received / expense_approved / order_complete /
-- payment_received were seeded and editable but NEVER fired.
--
-- Design (spec session 2026-07-16, arbitrage propriétaire) :
--   * DB AFTER triggers, exception-safe — a notification failure must NEVER
--     break the business write (money-path untouched: zero RPC bumps).
--   * `_enqueue_notification_system_v1` — SECURITY DEFINER mirror of
--     enqueue_notification_v2 WITHOUT the notifications.send gate. The gate is
--     for user-initiated sends; these triggers fire under the writing user's
--     auth.uid() (a cashier completing an order does NOT hold
--     notifications.send). EXECUTE is revoked from every app role — only the
--     trigger functions (SECURITY DEFINER, postgres-owned) can reach it.
--   * Internal alerts (low_stock / po_received / expense_approved) go to
--     business_config.alert_email (migration 20260716000168). NULL → skip.
--   * Customer emails (order_complete / payment_received) go to the customer
--     on the order/payment; no email on file → skip.
--   * Deterministic idempotency keys (uuid_v5) — replays and double-fires
--     collapse onto the first outbox row. low_stock is capped at one alert
--     per product per day.

-- =============================================================================
-- 1. Gate-free system enqueue (mirror of enqueue_notification_v2's body)
-- =============================================================================

CREATE FUNCTION public._enqueue_notification_system_v1(
  p_template_code text,
  p_recipient text,
  p_variables jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template  notification_templates%ROWTYPE;
  v_existing  UUID;
  v_id        UUID;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM notification_outbox
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_template
  FROM notification_templates
  WHERE code = p_template_code AND is_active = true;
  IF NOT FOUND THEN
    -- Template deactivated in /settings/notifications = the org opted out of
    -- this event. Silent no-op (the trigger callers treat it the same way).
    RETURN NULL;
  END IF;

  INSERT INTO notification_outbox (
    template_code, channel, recipient, subject, body, status,
    idempotency_key, scheduled_for, variables
  ) VALUES (
    p_template_code,
    v_template.channel,
    p_recipient,
    _notif_substitute(v_template.subject_template, COALESCE(p_variables, '{}'::jsonb)),
    _notif_substitute(v_template.body_template,    COALESCE(p_variables, '{}'::jsonb)),
    'queued',
    p_idempotency_key,
    now(),
    COALESCE(p_variables, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._enqueue_notification_system_v1(text, text, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._enqueue_notification_system_v1(text, text, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._enqueue_notification_system_v1(text, text, jsonb, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._enqueue_notification_system_v1(text, text, jsonb, uuid) TO service_role;

-- =============================================================================
-- 2. order_complete — retail order reaching completed/paid, customer attached
--    with an email. Fires on UPDATE and on INSERT (some RPC paths create the
--    order already completed); the uuid_v5 key collapses double-fires.
-- =============================================================================

CREATE FUNCTION public._trg_notify_order_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email TEXT;
  v_name  TEXT;
BEGIN
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
$function$;

CREATE TRIGGER trg_notify_order_complete_update
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.status::text IN ('completed','paid')
        AND OLD.status::text NOT IN ('completed','paid')
        AND NEW.customer_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_notify_order_complete();

CREATE TRIGGER trg_notify_order_complete_insert
  AFTER INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.status::text IN ('completed','paid') AND NEW.customer_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_notify_order_complete();

-- =============================================================================
-- 3. payment_received — B2B settlement recorded (record_b2b_payment_v2).
--    Retail is intentionally excluded: paying IS completing there, and the
--    customer already receives order_complete (no double email).
--    The template's {{order_number}} carries the payment_number.
-- =============================================================================

CREATE FUNCTION public._trg_notify_b2b_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email TEXT;
  v_name  TEXT;
BEGIN
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
$function$;

CREATE TRIGGER trg_notify_b2b_payment
  AFTER INSERT ON b2b_payments
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_notify_b2b_payment();

-- =============================================================================
-- 4. expense_approved — internal alert to business_config.alert_email.
-- =============================================================================

CREATE FUNCTION public._trg_notify_expense_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_alert     TEXT;
  v_requester TEXT;
  v_approver  TEXT;
  v_category  TEXT;
BEGIN
  BEGIN
    SELECT alert_email INTO v_alert FROM business_config WHERE id = 1;
    IF v_alert IS NULL OR length(trim(v_alert)) = 0 THEN RETURN NULL; END IF;

    SELECT up.full_name INTO v_requester FROM user_profiles up WHERE up.id = NEW.submitted_by;
    SELECT up.full_name INTO v_approver  FROM user_profiles up WHERE up.id = NEW.approved_by;
    SELECT ec.name      INTO v_category  FROM expense_categories ec WHERE ec.id = NEW.category_id;

    PERFORM _enqueue_notification_system_v1(
      'expense_approved',
      v_alert,
      jsonb_build_object(
        'expense_number', NEW.expense_number,
        'requester_name', COALESCE(v_requester, '—'),
        'category',       COALESCE(v_category, '—'),
        'amount',         NEW.amount,
        'approver_name',  COALESCE(v_approver, '—')
      ),
      extensions.uuid_generate_v5(
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
        'expense-approved-' || NEW.id::text
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_trg_notify_expense_approved skipped for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_notify_expense_approved
  AFTER UPDATE OF status ON expenses
  FOR EACH ROW
  WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION public._trg_notify_expense_approved();

-- =============================================================================
-- 5. po_received — internal alert to business_config.alert_email.
--    purchase_orders has no received_at column; the event time is now().
-- =============================================================================

CREATE FUNCTION public._trg_notify_po_received()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_alert    TEXT;
  v_supplier TEXT;
BEGIN
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
$function$;

CREATE TRIGGER trg_notify_po_received
  AFTER UPDATE OF status ON purchase_orders
  FOR EACH ROW
  WHEN (NEW.status = 'received' AND OLD.status IS DISTINCT FROM 'received')
  EXECUTE FUNCTION public._trg_notify_po_received();

-- =============================================================================
-- 6. low_stock_alert — edge-triggered on the GLOBAL stock crossing below the
--    per-product threshold (min_stock_threshold already feeds the BO alert
--    screens via get_low_stock_v1; this adds the missing email). Max one
--    alert per product per day (uuid_v5 on product+date).
-- =============================================================================

CREATE FUNCTION public._trg_notify_low_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_alert TEXT;
BEGIN
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
$function$;

CREATE TRIGGER trg_notify_low_stock
  AFTER UPDATE OF current_stock ON products
  FOR EACH ROW
  WHEN (NEW.current_stock < NEW.min_stock_threshold
        AND OLD.current_stock >= OLD.min_stock_threshold)
  EXECUTE FUNCTION public._trg_notify_low_stock();

-- =============================================================================
-- 7. Lock down the trigger functions (never user-callable; they only run as
--    triggers, executing as their postgres owner).
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public._trg_notify_order_complete()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_notify_b2b_payment()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_notify_expense_approved() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_notify_po_received()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_notify_low_stock()        FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
