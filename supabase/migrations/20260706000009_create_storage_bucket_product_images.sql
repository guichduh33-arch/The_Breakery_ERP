-- 20260706000010_create_storage_bucket_product_images.sql
-- Standalone fix : product photo upload (BO ProductDetail → GeneralPanel "Visual Asset").
--
-- The "Drag and drop or click to upload" card was a dead placeholder — no bucket,
-- no upload wiring. This creates a PUBLIC bucket `product-images` so product photos
-- can be served by public URL (non-sensitive catalog imagery), with writes gated to
-- `products.update` (defense-in-depth alongside the UI PermissionGate).
--
-- Path convention: products/{product_id}/{filename}.
--
-- Policy matrix (storage.objects scoped to bucket_id='product-images'):
--   SELECT          : public (anon + authenticated) — bucket is public.
--   INSERT/UPDATE/DELETE : authenticated AND has_permission(auth.uid(),'products.update').

BEGIN;

-- =============================================================================
-- 1. Bucket (public read)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,                                                        -- public read
  5 * 1024 * 1024,                                             -- 5 MB max per file
  ARRAY['image/jpeg','image/png','image/webp','image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- =============================================================================
-- 2. RLS policies on storage.objects scoped to bucket_id='product-images'
-- =============================================================================

-- SELECT : public read (bucket is public; CDN serves via public URL).
DROP POLICY IF EXISTS product_images_select ON storage.objects;
CREATE POLICY product_images_select ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'product-images');

-- INSERT : catalog editors only.
DROP POLICY IF EXISTS product_images_insert ON storage.objects;
CREATE POLICY product_images_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND has_permission(auth.uid(), 'products.update')
  );

-- UPDATE : catalog editors only (covers overwrite / upsert).
DROP POLICY IF EXISTS product_images_update ON storage.objects;
CREATE POLICY product_images_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND has_permission(auth.uid(), 'products.update')
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND has_permission(auth.uid(), 'products.update')
  );

-- DELETE : catalog editors only.
DROP POLICY IF EXISTS product_images_delete ON storage.objects;
CREATE POLICY product_images_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND has_permission(auth.uid(), 'products.update')
  );

COMMIT;
