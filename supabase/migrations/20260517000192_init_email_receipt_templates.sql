-- 20260517000192_init_email_receipt_templates.sql
-- Session 13 / Phase 5.C
--
-- Customer-facing email templates AND receipt print templates. Both are
-- managed by admins via the BO Settings page.
--
-- Distinction (D-W5-5C-04) : `email_templates` here is for marketing /
-- customer-facing emails (welcome, order_complete, payment_received,
-- password_reset). Phase 5.B's `notification_templates` (if it ships)
-- is for system events (low stock alerts, fiscal close, etc.). The two
-- cover distinct use-cases by design.
--
-- RLS : SELECT to authenticated, INSERT/UPDATE/DELETE to ADMIN+ via
-- `settings.update`.

------------------------------------------------------------------------
-- email_templates
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,
  subject      TEXT NOT NULL,
  body_html    TEXT NOT NULL,
  body_text    TEXT NOT NULL,
  variables    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_active
  ON email_templates(is_active);

CREATE TRIGGER email_templates_set_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_templates_select_authenticated
  ON email_templates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY email_templates_insert_update
  ON email_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'settings.update'));

CREATE POLICY email_templates_update_update
  ON email_templates
  FOR UPDATE
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.update'))
  WITH CHECK (has_permission(auth.uid(), 'settings.update'));

CREATE POLICY email_templates_delete_update
  ON email_templates
  FOR DELETE
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.update'));

COMMENT ON TABLE email_templates IS
  'Session 13 / Phase 5.C. Customer-facing email templates (welcome, order_complete, payment_received, password_reset). Distinct from any system-event notification_templates that Phase 5.B may ship. Variables is a JSONB array of declared interpolation tokens (e.g. ["{{customer_name}}", "{{order_number}}"]).';

------------------------------------------------------------------------
-- receipt_templates
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipt_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  header       TEXT,
  footer       TEXT,
  paper_size   TEXT NOT NULL CHECK (paper_size IN ('58mm','80mm','A4')),
  show_qr      BOOLEAN NOT NULL DEFAULT false,
  show_logo    BOOLEAN NOT NULL DEFAULT true,
  custom_css   TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one default template at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_templates_one_default
  ON receipt_templates((is_default))
  WHERE is_default = true;

CREATE TRIGGER receipt_templates_set_updated_at
  BEFORE UPDATE ON receipt_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE receipt_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY receipt_templates_select_authenticated
  ON receipt_templates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY receipt_templates_insert_update
  ON receipt_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'settings.update'));

CREATE POLICY receipt_templates_update_update
  ON receipt_templates
  FOR UPDATE
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.update'))
  WITH CHECK (has_permission(auth.uid(), 'settings.update'));

CREATE POLICY receipt_templates_delete_update
  ON receipt_templates
  FOR DELETE
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.update'));

COMMENT ON TABLE receipt_templates IS
  'Session 13 / Phase 5.C. Receipt print templates (58mm thermal, 80mm thermal, A4 invoice). Header/footer carry free-form merchant copy. show_qr toggles a payment QR (e.g. invoice link). show_logo toggles the business logo. custom_css is an opt-in styling override applied by the print renderer.';

------------------------------------------------------------------------
-- Seeds : 4 email templates + 1 default receipt template.
------------------------------------------------------------------------
INSERT INTO email_templates (code, subject, body_html, body_text, variables, is_active) VALUES
  (
    'welcome',
    'Welcome to The Breakery, {{customer_name}}!',
    '<p>Hi {{customer_name}},</p><p>Welcome to The Breakery. Your account is now active.</p><p>— The Breakery team</p>',
    'Hi {{customer_name}},

Welcome to The Breakery. Your account is now active.

— The Breakery team',
    '["{{customer_name}}"]'::jsonb,
    true
  ),
  (
    'order_complete',
    'Your order #{{order_number}} is ready',
    '<p>Hi {{customer_name}},</p><p>Your order <strong>#{{order_number}}</strong> for {{order_total}} is ready for pickup.</p>',
    'Hi {{customer_name}},

Your order #{{order_number}} for {{order_total}} is ready for pickup.',
    '["{{customer_name}}", "{{order_number}}", "{{order_total}}"]'::jsonb,
    true
  ),
  (
    'payment_received',
    'Payment received — receipt #{{order_number}}',
    '<p>Hi {{customer_name}},</p><p>We''ve received your payment of <strong>{{order_total}}</strong> for order #{{order_number}}. Thank you!</p>',
    'Hi {{customer_name}},

We''ve received your payment of {{order_total}} for order #{{order_number}}. Thank you!',
    '["{{customer_name}}", "{{order_number}}", "{{order_total}}"]'::jsonb,
    true
  ),
  (
    'password_reset',
    'Reset your password',
    '<p>Hi {{customer_name}},</p><p>Click <a href="{{reset_link}}">here</a> to reset your password. This link expires in 1 hour.</p>',
    'Hi {{customer_name}},

Click the following link to reset your password (expires in 1 hour):
{{reset_link}}',
    '["{{customer_name}}", "{{reset_link}}"]'::jsonb,
    true
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO receipt_templates (name, header, footer, paper_size, show_qr, show_logo, custom_css, is_default) VALUES
  (
    'Default 80mm',
    'The Breakery
Lombok, Indonesia',
    'Thank you for your visit!
Find us on Instagram @thebreakery',
    '80mm',
    false,
    true,
    NULL,
    true
  )
ON CONFLICT (name) DO NOTHING;
