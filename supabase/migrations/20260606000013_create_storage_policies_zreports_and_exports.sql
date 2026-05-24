-- 20260606000013_create_storage_policies_zreports_and_exports.sql
-- S29 Wave 1.A.4 — RLS policies sur storage.objects pour les 2 buckets.
-- NOTE: user_has_permission(text) n'existe pas dans ce projet.
-- Le helper s'appelle has_permission(p_uid uuid, p_perm text) — adapté en conséquence.

-- zreports/ : SELECT requires zreports.read permission.
-- INSERT/UPDATE/DELETE = postgres role only (via service_role key dans EF generate-zreport-pdf).
CREATE POLICY zreports_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'zreports' AND has_permission(auth.uid(), 'zreports.read'));

-- reports-exports/ : SELECT + INSERT + DELETE pour owner uniquement.
CREATE POLICY reports_exports_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'reports-exports' AND owner = auth.uid());

CREATE POLICY reports_exports_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reports-exports' AND owner = auth.uid());

CREATE POLICY reports_exports_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'reports-exports' AND owner = auth.uid());

COMMENT ON POLICY zreports_select ON storage.objects IS
  'S29 : metadata Z-Report row accessible auth, mais le PDF binary nécessite zreports.read perm (manager+). Adapté: has_permission(auth.uid(), perm) car user_has_permission(text) n''existe pas dans ce projet.';
