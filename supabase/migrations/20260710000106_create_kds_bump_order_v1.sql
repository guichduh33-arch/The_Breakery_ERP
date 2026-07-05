-- 20260710000106_create_kds_bump_order_v1.sql
-- S60 (04 D1.2): "All ready" — atomically bump every live pending/preparing
-- item of an order to ready in one atomic UPDATE.
--
-- Rationale: kds_bump_item_v1 (20260517000151) requires kitchen_status =
-- 'preparing' (raises P0011 otherwise), so a client-side loop over items
-- would silently skip any still-pending item, and N calls would be
-- non-atomic (partial failure) plus N audit rows for a single operator
-- gesture. This RPC covers pending|preparing -> ready in a single UPDATE,
-- scoped by order like kds_recall_order_v1.
--
-- Audit shape + idempotent-replay lookup mirror the LIVE body of
-- kds_bump_item_v1 exactly (read via pg_get_functiondef before writing this
-- migration): actor_id/action/entity_type/entity_id/metadata column order,
-- and the `metadata ? 'idempotency_key' AND metadata->>'idempotency_key' = ...`
-- replay lookup. As in kds_bump_item_v1, the audit_logs row (and therefore
-- replay support) is only written when a non-NULL p_idempotency_key is
-- supplied; the POS hook always mints one, so real traffic is always
-- audited. The bumped count is additionally stored in metadata
-- ('bumped_count') so a replay can return the original count without
-- re-scanning order_items.

CREATE OR REPLACE FUNCTION public.kds_bump_order_v1(
  p_order_id uuid,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_count  INTEGER;
  v_replay INTEGER;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order not found: %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT (metadata->>'bumped_count')::integer INTO v_replay
      FROM audit_logs
     WHERE action = 'kds.bump_order'
       AND entity_type = 'order'
       AND entity_id = p_order_id
       AND metadata ? 'idempotency_key'
       AND metadata->>'idempotency_key' = p_idempotency_key::TEXT
     LIMIT 1;
    IF FOUND THEN
      RETURN v_replay;
    END IF;
  END IF;

  UPDATE order_items
     SET kitchen_status = 'ready',
         ready_at       = NOW(),
         bumped_at      = NOW()
   WHERE order_id = p_order_id
     AND kitchen_status IN ('pending', 'preparing')
     AND is_cancelled = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      auth.uid(),
      'kds.bump_order',
      'order',
      p_order_id,
      jsonb_build_object(
        'idempotency_key', p_idempotency_key::TEXT,
        'bumped_count',    v_count
      )
    );
  END IF;

  RETURN v_count;
END $function$;

REVOKE ALL ON FUNCTION public.kds_bump_order_v1(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kds_bump_order_v1(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.kds_bump_order_v1(uuid, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.kds_bump_order_v1(uuid, uuid) IS
  'S60 (04 D1.2) - KDS "All ready": bumps all live pending/preparing items of an order to ready '
  'in one atomic UPDATE. Gate kds.operate. Idempotent replay via audit_logs kds.bump_order '
  '(mirrors kds_bump_item_v1 pattern; audit write skipped when no idempotency key is supplied).';
