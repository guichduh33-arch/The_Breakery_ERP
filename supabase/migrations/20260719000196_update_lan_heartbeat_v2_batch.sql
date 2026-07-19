-- 20260719000196_update_lan_heartbeat_v2_batch.sql
-- Spec 006x lot 2 — le hub LAN devient l'écrivain unique du heartbeat cloud :
-- il agrège la présence du bus et pousse un BATCH via l'EF lan-heartbeat-batch
-- (service_role). Les terminaux gardent un fallback direct (batch de 1) quand
-- le hub est injoignable (mode dégradé actuel, spec §3-A3).
--
-- v1 (unitaire, P0002 si code inconnu) → v2 (batch, codes inconnus/soft-deleted
-- IGNORÉS : un code mort ne doit jamais faire échouer le heartbeat des autres).
-- RPC versioning monotone : v2 créée, v1 droppée dans la même migration.

CREATE FUNCTION update_lan_heartbeat_v2(
  p_device_codes TEXT[]
) RETURNS TABLE (code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE lan_devices d
     SET last_heartbeat_at = NOW(),
         is_active = TRUE
   WHERE d.code = ANY(p_device_codes)
     AND d.deleted_at IS NULL
  RETURNING d.code;
END;
$$;

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC — révoquer les deux.
REVOKE ALL ON FUNCTION update_lan_heartbeat_v2(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_lan_heartbeat_v2(TEXT[]) FROM anon;
-- authenticated : fallback direct des terminaux (batch de 1) quand le hub est
-- down. service_role : chemin nominal via l'EF lan-heartbeat-batch.
GRANT EXECUTE ON FUNCTION update_lan_heartbeat_v2(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION update_lan_heartbeat_v2(TEXT[]) TO service_role;

COMMENT ON FUNCTION update_lan_heartbeat_v2(TEXT[]) IS
  'Spec 006x lot 2 — touch batch de lan_devices.last_heartbeat_at. Écrivain nominal = hub LAN (EF lan-heartbeat-batch, service_role) ; fallback terminal direct (authenticated, batch de 1) si hub down. Codes inconnus/soft-deleted ignorés ; retourne les codes touchés.';

DROP FUNCTION update_lan_heartbeat_v1(TEXT);
