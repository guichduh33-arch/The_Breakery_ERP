-- 20260606000010_create_enum_z_report_status.sql
-- S29 Wave 1.A.1 — ENUM des status Z-Report.
CREATE TYPE z_report_status AS ENUM ('draft', 'signed', 'voided');

COMMENT ON TYPE z_report_status IS
  'S29 : status d''un Z-Report. draft = créé au close_shift, signed = signé par manager via PIN, voided = invalidé admin avec reason.';
