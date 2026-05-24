-- 20260606000012_create_storage_buckets_zreports_and_exports.sql
-- S29 Wave 1.A.3 — Storage buckets pour Z-Report (7 ans) + exports user-triggered (TTL 30j).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('zreports',        'zreports',        false, 10485760, ARRAY['application/pdf']),
  ('reports-exports', 'reports-exports', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN storage.buckets.id IS
  'S29 : zreports = 7 ans retention compliance ID ; reports-exports = TTL 30j PDF user-triggered régénérables.';
