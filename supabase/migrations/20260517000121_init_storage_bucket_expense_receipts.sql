-- 20260517000121_init_storage_bucket_expense_receipts.sql
-- Session 13 / Phase 3.B / Migration 121 : Storage bucket for expense receipts.
--
-- Creates private bucket `expense-receipts` and RLS policies on storage.objects
-- restricted to the path convention `expenses/{expense_id}/...`.
--
-- Policy matrix (auth):
--   SELECT : any authenticated user (read receipts they have RLS access to).
--   INSERT : owner of expense (created_by = current profile, status='draft')
--            OR has_permission('expenses.manage').
--   UPDATE/DELETE : same as INSERT.

BEGIN;

-- =============================================================================
-- 1. Bucket
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,                                                       -- private
  5 * 1024 * 1024,                                             -- 5 MB max per file
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- =============================================================================
-- 2. Helper : parse expense_id from object path 'expenses/{uuid}/...'
-- =============================================================================

CREATE OR REPLACE FUNCTION storage_path_to_expense_id(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parts TEXT[];
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  v_parts := string_to_array(p_name, '/');
  IF array_length(v_parts, 1) < 2 OR v_parts[1] <> 'expenses' THEN
    RETURN NULL;
  END IF;
  -- Try cast; if invalid UUID, return NULL.
  BEGIN
    RETURN v_parts[2]::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END $$;

COMMENT ON FUNCTION storage_path_to_expense_id(TEXT) IS
  'Phase 3.B : extract expense_id (UUID) from storage object path "expenses/{uuid}/<file>". Returns NULL if not matching.';

-- =============================================================================
-- 3. RLS policies on storage.objects scoped to bucket_id='expense-receipts'
-- =============================================================================

-- SELECT : any authenticated user (let app + expenses RLS guard which expense is visible).
DROP POLICY IF EXISTS expense_receipts_select ON storage.objects;
CREATE POLICY expense_receipts_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts');

-- INSERT : manager+ OR creator of the expense (still draft).
DROP POLICY IF EXISTS expense_receipts_insert ON storage.objects;
CREATE POLICY expense_receipts_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (
      has_permission(auth.uid(), 'expenses.manage')
      OR EXISTS (
        SELECT 1
        FROM expenses e
        JOIN user_profiles up ON up.auth_user_id = auth.uid()
        WHERE e.id = storage_path_to_expense_id(name)
          AND e.created_by = up.id
          AND e.status = 'draft'
      )
    )
  );

-- UPDATE : same gate as INSERT.
DROP POLICY IF EXISTS expense_receipts_update ON storage.objects;
CREATE POLICY expense_receipts_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (
      has_permission(auth.uid(), 'expenses.manage')
      OR EXISTS (
        SELECT 1
        FROM expenses e
        JOIN user_profiles up ON up.auth_user_id = auth.uid()
        WHERE e.id = storage_path_to_expense_id(name)
          AND e.created_by = up.id
          AND e.status = 'draft'
      )
    )
  );

-- DELETE : manager+ only (audit safety).
DROP POLICY IF EXISTS expense_receipts_delete ON storage.objects;
CREATE POLICY expense_receipts_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND has_permission(auth.uid(), 'expenses.manage')
  );

COMMIT;
