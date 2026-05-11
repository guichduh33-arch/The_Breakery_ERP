-- 20260512000004_init_refunds.sql
-- Session 10 — post-checkout refunds (partial + full-void mirror).
-- Three tables form the refund unit:
--   - refunds        : header (R-XXXX number, total, tax_refunded, audit fields)
--   - refund_lines   : per-order_item refunded qty + amount (pro-rata of original line_total)
--   - refund_payments: per-method amount restored (routing chosen by cashier)
--
-- Both partial refund (refund_order_rpc) and full void (void_order_rpc) write here ;
-- void uses is_full_void=true to flag the audit shortcut. Reports session 14 will
-- distinguish. RLS: authenticated read only ; INSERT only via SECURITY DEFINER RPCs.

CREATE TABLE refund_sequences (
  date          DATE PRIMARY KEY,
  last_number   INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE refund_sequences IS
  'Session 10: per-day counter for refund_number generation (R-0001, R-0002, ...). Mirror of order_sequences.';

CREATE TABLE refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number   TEXT NOT NULL UNIQUE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  session_id      UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE RESTRICT,
  total           DECIMAL(14,2) NOT NULL CHECK (total > 0),
  tax_refunded    DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (tax_refunded >= 0),
  reason          TEXT NOT NULL CHECK (length(reason) >= 3),
  refunded_by     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  authorized_by   UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  is_full_void    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refunds_order   ON refunds(order_id, created_at DESC);
CREATE INDEX idx_refunds_session ON refunds(session_id, created_at DESC);

COMMENT ON TABLE refunds IS
  'Session 10: header for partial refund or full-void mirror. is_full_void distinguishes void shortcut from a true partial refund.';

CREATE TABLE refund_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id       UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_item_id   UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  qty             DECIMAL(14,3) NOT NULL CHECK (qty > 0),
  amount          DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (refund_id, order_item_id)
);

CREATE INDEX idx_refund_lines_order_item ON refund_lines(order_item_id);

COMMENT ON TABLE refund_lines IS
  'Session 10: refunded qty per order_item. amount = round_idr(line_total * qty / order_item.quantity).';

CREATE TABLE refund_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id       UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  method          payment_method NOT NULL,
  amount          DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  reference       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refund_payments_refund ON refund_payments(refund_id);
CREATE INDEX idx_refund_payments_method ON refund_payments(method, created_at DESC);

COMMENT ON TABLE refund_payments IS
  'Session 10: per-method tender split for the refund. Sum equals refunds.total.';

-- RLS : read-only for authenticated. INSERT only via SECURITY DEFINER RPCs (no INSERT policy).
ALTER TABLE refunds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_payments  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON refunds         FOR SELECT USING (is_authenticated());
CREATE POLICY "auth_read" ON refund_lines    FOR SELECT USING (is_authenticated());
CREATE POLICY "auth_read" ON refund_payments FOR SELECT USING (is_authenticated());
