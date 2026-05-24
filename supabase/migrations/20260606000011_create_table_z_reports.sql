-- 20260606000011_create_table_z_reports.sql
-- S29 Wave 1.A.2 — table z_reports (append-only metadata, signature via UPDATE RPC).
CREATE TABLE z_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id            UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE RESTRICT,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at           TIMESTAMPTZ NULL,
  signed_by           UUID NULL REFERENCES user_profiles(id),
  voided_at           TIMESTAMPTZ NULL,
  voided_by           UUID NULL REFERENCES user_profiles(id),
  void_reason         TEXT NULL,
  pdf_storage_path    TEXT NULL,
  status              z_report_status NOT NULL DEFAULT 'draft',
  snapshot            JSONB NOT NULL,
  CONSTRAINT uniq_zreport_shift UNIQUE (shift_id),
  CONSTRAINT zreport_status_signed_consistency CHECK (
    (status = 'signed') = (signed_at IS NOT NULL AND signed_by IS NOT NULL)
  ),
  CONSTRAINT zreport_status_voided_consistency CHECK (
    (status = 'voided') = (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(void_reason) >= 10)
  )
);

CREATE INDEX idx_zreports_shift ON z_reports (shift_id);
CREATE INDEX idx_zreports_status_generated ON z_reports (status, generated_at DESC);

ALTER TABLE z_reports ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON z_reports FROM authenticated, anon, PUBLIC;
GRANT SELECT ON z_reports TO authenticated;

CREATE POLICY zreports_select_auth ON z_reports
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE z_reports IS
  'S29 : Z-Report archive 7 ans (compliance ID). UNIQUE(shift_id) = un Z-Report par shift. Snapshot figé au close_shift. Status draft → signed (PIN manager) | voided (admin avec reason).';
COMMENT ON COLUMN z_reports.snapshot IS
  'JSONB figé au close_shift : period_start, period_end, opening_cash, closing_cash_expected, closing_cash_counted, variance, totals_by_payment_method, sales_total, refunds_total, voids_total, top_products[], expenses_cash_total, ...';
