-- 20261116000001_ensure_storage_buckets.sql
--
-- La production V3 a été bâtie depuis le schéma (scripts/release/bootstrap-*),
-- qui traite les buckets comme des « candidats de configuration » : seuls
-- `zreports` et `reports-exports` y existent. Les lignes de `storage.buckets`
-- posées par les migrations d'origine n'y ont jamais été rejouées. Constat du
-- 2026-11-16 : impossible d'ajouter une photo produit ou un justificatif de
-- dépense en production, parce que leur bucket n'existe pas.
--
-- Cette migration recrée les trois buckets que des migrations définissent
-- déjà, avec la configuration de ces migrations (identique à la base dev) :
--   - expense-receipts : 20260517000121_init_storage_bucket_expense_receipts.sql
--   - product-images   : 20260706000009_create_storage_bucket_product_images.sql
--   - branding         : 20260716000168_settings_business_identity.sql
-- Les policies de `storage.objects` existent déjà en production : rien à y
-- toucher. ON CONFLICT DO NOTHING : sans effet là où le bucket existe (dev),
-- et aucune configuration réglée à la main n'est écrasée.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('expense-receipts', 'expense-receipts', false, 5 * 1024 * 1024,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf']),
  ('product-images',   'product-images',   true,  5 * 1024 * 1024,
   ARRAY['image/jpeg','image/png','image/webp','image/avif']),
  ('branding',         'branding',         true,  1 * 1024 * 1024,
   ARRAY['image/png','image/jpeg'])
ON CONFLICT (id) DO NOTHING;
