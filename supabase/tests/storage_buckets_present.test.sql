-- supabase/tests/storage_buckets_present.test.sql
-- Les buckets dont dépendent les téléversements du back-office existent,
-- avec la configuration de leurs migrations (20261116000001_ensure_storage_buckets.sql).
-- Une base bâtie sans eux (production V3, constat du 2026-11-16) rend
-- impossibles la photo produit, le justificatif de dépense et le logo.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

SELECT results_eq(
  $$SELECT public, file_size_limit::bigint, allowed_mime_types
      FROM storage.buckets WHERE id = 'expense-receipts'$$,
  -- ADR-037 (20261116000010) : JPEG ou PDF seulement pour les nouveaux dépôts.
  $$VALUES (false, 5242880::bigint, ARRAY['image/jpeg','application/pdf'])$$,
  'expense-receipts bucket exists, private, 5 MB, receipt formats'
);
SELECT results_eq(
  $$SELECT public, file_size_limit::bigint, allowed_mime_types
      FROM storage.buckets WHERE id = 'product-images'$$,
  $$VALUES (true, 5242880::bigint, ARRAY['image/jpeg','image/png','image/webp','image/avif'])$$,
  'product-images bucket exists, public, 5 MB, image formats'
);
SELECT results_eq(
  $$SELECT public, file_size_limit::bigint, allowed_mime_types
      FROM storage.buckets WHERE id = 'branding'$$,
  $$VALUES (true, 1048576::bigint, ARRAY['image/png','image/jpeg'])$$,
  'branding bucket exists, public, 1 MB, PNG/JPEG'
);
SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
  AND tablename = 'objects' AND policyname = 'expense_receipts_insert'),
  'expense_receipts_insert policy exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
  AND tablename = 'objects' AND policyname = 'product_images_insert'),
  'product_images_insert policy exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
  AND tablename = 'objects' AND policyname = 'branding_insert'),
  'branding_insert policy exists');

SELECT * FROM finish();

ROLLBACK;
