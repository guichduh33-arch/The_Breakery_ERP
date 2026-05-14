-- 20260517000180_init_notification_templates.sql
-- Session 13 / Phase 5.B — Notifications pipeline (MVP email-only).
--
-- Tables :
--   notification_templates : seed of all message bodies + channel + subject
--   notification_outbox    : append-mostly queue (status transitions only)
--
-- RPC :
--   enqueue_notification_v1(p_template_code, p_recipient, p_variables,
--                           p_channel, p_scheduled_for, p_idempotency_key)
--     RETURNS UUID — SECURITY DEFINER, gated on `notifications.send`.
--
-- Permission :
--   notifications.send (module='notifications', action='send') — granted
--   to MANAGER, ADMIN, SUPER_ADMIN.
--
-- Deviations recorded under D-W5-5B-01..08 in the Wave 5 deviation pack.

-- ---------------------------------------------------------------------------
-- 1. notification_templates
-- ---------------------------------------------------------------------------

CREATE TABLE notification_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,
  channel           TEXT NOT NULL CHECK (channel IN ('email','sms','push','inapp')),
  subject_template  TEXT,
  body_template     TEXT NOT NULL,
  variables         JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_templates_active
  ON notification_templates(code) WHERE is_active = true;

CREATE TRIGGER notification_templates_set_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE notification_templates IS
  'Notification message templates (Session 13 / Phase 5.B). One row per template_code. Bodies use {{var}} Mustache-lite grammar — see packages/domain/src/notifications/composeMessage.ts. v1 channels = email (D5).';
COMMENT ON COLUMN notification_templates.code IS
  'Stable identifier referenced by code (e.g. order_complete). Never change after seeding ; downstream consumers reference it.';
COMMENT ON COLUMN notification_templates.variables IS
  'Documentation-only JSONB array of expected variable names. Not enforced by the RPC ; composeMessage flags missing vars at compose time.';

-- ---------------------------------------------------------------------------
-- 2. notification_outbox
-- ---------------------------------------------------------------------------

CREATE TABLE notification_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code       TEXT NOT NULL REFERENCES notification_templates(code),
  channel             TEXT NOT NULL CHECK (channel IN ('email','sms','push','inapp')),
  recipient           TEXT NOT NULL,
  subject             TEXT,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','sending','sent','failed','retry')),
  error_message       TEXT,
  retries             INT NOT NULL DEFAULT 0 CHECK (retries >= 0),
  idempotency_key     UUID,
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ,
  provider_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_outbox_status_scheduled
  ON notification_outbox(status, scheduled_for)
  WHERE status IN ('queued','retry');

CREATE UNIQUE INDEX uq_notification_outbox_idempotency
  ON notification_outbox(idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE notification_outbox IS
  'Notification dispatch queue (Session 13 / Phase 5.B). Status transitions queued -> sending -> {sent | retry | failed}. notification-dispatch EF polls (queued,retry) WHERE scheduled_for <= now() LIMIT 50 FOR UPDATE SKIP LOCKED.';
COMMENT ON COLUMN notification_outbox.idempotency_key IS
  'Caller-supplied UUID to dedupe enqueues. enqueue_notification_v1 returns the existing row id when set and matched.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox    ENABLE ROW LEVEL SECURITY;

-- Templates : any authenticated user can read active ones (the channel
-- layer needs to inspect them) ; mutations go through migrations / future
-- 5.C templates UI gated by has_permission('notifications.send').
CREATE POLICY notification_templates_select_authenticated
  ON notification_templates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY notification_templates_write_send
  ON notification_templates
  FOR ALL
  TO authenticated
  USING (has_permission(auth.uid(), 'notifications.send'))
  WITH CHECK (has_permission(auth.uid(), 'notifications.send'));

-- Outbox : SELECT for authenticated (managers will read for dashboards) ;
-- writes go only through SECURITY DEFINER RPC. No INSERT/UPDATE/DELETE
-- policy = blocked for `authenticated` ; the service_role used by the
-- notification-dispatch EF bypasses RLS.
CREATE POLICY notification_outbox_select_authenticated
  ON notification_outbox
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 4. Permission seeds
-- ---------------------------------------------------------------------------

INSERT INTO permissions (code, module, action, description) VALUES
  ('notifications.send', 'notifications', 'send', 'Enqueue notifications (templates + outbox)')
ON CONFLICT (code) DO NOTHING;

-- Grant to manager+ — SUPER_ADMIN inherits via unconditional branch in
-- has_permission ; explicit grants for MANAGER + ADMIN.
INSERT INTO role_permissions (role_code, permission_code)
SELECT r.role_code, 'notifications.send'
FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(role_code)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. RPC enqueue_notification_v1
-- ---------------------------------------------------------------------------

-- Helper : pure-SQL {{var}} substitution that mirrors
-- packages/domain/src/notifications/composeMessage.ts. Missing vars are
-- left as literal placeholders. Identifier grammar : [a-zA-Z_][a-zA-Z0-9_]*.
CREATE OR REPLACE FUNCTION _notif_substitute(p_source TEXT, p_vars JSONB)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_result TEXT := COALESCE(p_source, '');
  v_match  TEXT;
  v_key    TEXT;
  v_val    TEXT;
BEGIN
  IF p_source IS NULL THEN RETURN ''; END IF;
  -- Iterate matches with a regex extraction loop. regexp_matches() with
  -- 'g' returns one match per row.
  FOR v_match, v_key IN
    SELECT m[1], m[2]
    FROM regexp_matches(p_source, '(\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\})', 'g') AS t(m)
  LOOP
    -- Skip if already replaced by an earlier iteration with the same key.
    IF position(v_match in v_result) = 0 THEN CONTINUE; END IF;
    IF p_vars ? v_key AND jsonb_typeof(p_vars->v_key) <> 'null' THEN
      v_val := CASE jsonb_typeof(p_vars->v_key)
        WHEN 'string' THEN p_vars->>v_key
        ELSE p_vars->v_key #>> '{}'
      END;
      v_result := replace(v_result, v_match, COALESCE(v_val, v_match));
    END IF;
    -- If missing, leave v_match in place (no replacement).
  END LOOP;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION _notif_substitute(TEXT, JSONB) IS
  'Internal helper for enqueue_notification_v1 — mirrors composeMessage.ts grammar. Not for direct app use.';

CREATE OR REPLACE FUNCTION enqueue_notification_v1(
  p_template_code   TEXT,
  p_recipient       TEXT,
  p_variables       JSONB DEFAULT '{}'::jsonb,
  p_channel         TEXT  DEFAULT NULL,
  p_scheduled_for   TIMESTAMPTZ DEFAULT NULL,
  p_idempotency_key UUID  DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_template  notification_templates%ROWTYPE;
  v_channel   TEXT;
  v_subject   TEXT;
  v_body      TEXT;
  v_existing  UUID;
  v_id        UUID;
BEGIN
  -- 1. Permission gate (skip when called by service_role — auth.uid() is NULL).
  IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), 'notifications.send') THEN
    RAISE EXCEPTION 'permission_denied: notifications.send' USING ERRCODE = '42501';
  END IF;

  -- 2. Idempotency replay : caller-supplied UUID returns the existing row.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM notification_outbox
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  -- 3. Resolve template.
  SELECT * INTO v_template
  FROM notification_templates
  WHERE code = p_template_code AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found: %', p_template_code USING ERRCODE = 'P0002';
  END IF;

  v_channel := COALESCE(p_channel, v_template.channel);
  IF v_channel NOT IN ('email','sms','push','inapp') THEN
    RAISE EXCEPTION 'invalid_channel: %', v_channel USING ERRCODE = '22023';
  END IF;

  -- 4. Substitute variables (server-side mirror of composeMessage.ts).
  v_subject := _notif_substitute(v_template.subject_template, COALESCE(p_variables, '{}'::jsonb));
  v_body    := _notif_substitute(v_template.body_template,    COALESCE(p_variables, '{}'::jsonb));

  -- 5. Insert outbox row.
  INSERT INTO notification_outbox (
    template_code, channel, recipient, subject, body, status,
    idempotency_key, scheduled_for
  ) VALUES (
    p_template_code, v_channel, p_recipient, v_subject, v_body, 'queued',
    p_idempotency_key, COALESCE(p_scheduled_for, now())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION enqueue_notification_v1(TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, UUID) IS
  'Session 13 / Phase 5.B — enqueue a notification. Gates on notifications.send. Substitutes {{var}} placeholders server-side. Idempotent via p_idempotency_key.';

-- Permissions — authenticated can call, but RPC self-gates on
-- has_permission. Service_role (used by EFs) bypasses RLS.
REVOKE ALL ON FUNCTION enqueue_notification_v1(TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_notification_v1(TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Seed 6 templates
-- ---------------------------------------------------------------------------

INSERT INTO notification_templates (code, channel, subject_template, body_template, variables) VALUES
  ('order_complete',
   'email',
   'Order {{order_number}} is ready',
   E'Hi {{customer_name}},\n\nYour order {{order_number}} (Rp {{total}}) is ready for pickup at The Breakery.\n\nThanks for your purchase!\n\n— The Breakery Team',
   '["order_number","customer_name","total"]'::jsonb),

  ('payment_received',
   'email',
   'Payment received for order {{order_number}}',
   E'Hi {{customer_name}},\n\nWe have received your payment of Rp {{amount}} for order {{order_number}} via {{payment_method}}.\n\nThanks!\n— The Breakery',
   '["order_number","customer_name","amount","payment_method"]'::jsonb),

  ('customer_birthday',
   'email',
   'Happy Birthday, {{customer_name}}!',
   E'Hi {{customer_name}},\n\nHappy birthday from The Breakery! We have credited {{bonus_points}} bonus points to your loyalty account.\n\nSee you soon!\n— The Breakery Team',
   '["customer_name","bonus_points"]'::jsonb),

  ('low_stock_alert',
   'email',
   '[Low stock] {{product_name}} below threshold',
   E'Inventory alert: {{product_name}} is at {{current_stock}} {{unit}} (threshold: {{threshold}} {{unit}}).\n\nPlease reorder via the Purchasing module.\n\n— The Breakery ERP',
   '["product_name","current_stock","threshold","unit"]'::jsonb),

  ('po_received',
   'email',
   'PO {{po_number}} received from {{supplier_name}}',
   E'Purchase order {{po_number}} from {{supplier_name}} has been received.\nTotal: Rp {{total}}\nReceived on: {{received_at}}\n\n— The Breakery ERP',
   '["po_number","supplier_name","total","received_at"]'::jsonb),

  ('expense_approved',
   'email',
   'Expense {{expense_number}} approved',
   E'Hi {{requester_name}},\n\nYour expense {{expense_number}} ({{category}} — Rp {{amount}}) has been approved by {{approver_name}}.\n\n— The Breakery ERP',
   '["expense_number","requester_name","category","amount","approver_name"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
