-- S72 — POS audit fix: harden mark_item_served (KDS ready -> served handoff).
--
-- Two defects on the same function (unversioned; SECURITY DEFINER):
--   1) FK bug (same root cause as close_shift_v6): the body wrote
--      served_by = auth.uid(), but order_items.served_by is a FK to
--      user_profiles(id). For any real (create_user_v1) user, id <> auth_user_id
--      -> foreign_key_violation -> the item cannot be marked served. Masked by
--      the seed accounts (id == auth_user_id).
--   2) No permission gate: every authenticated user could serve, regardless of
--      kds.operate — the only KDS RPC without a gate (bump/undo/recall/prep-timer
--      all check kds.operate). anon EXECUTE was already revoked at the ACL level
--      (proacl carried no PUBLIC/anon entry), but we re-assert the S20 trio here
--      for defense in depth.
--
-- Fix = resolve the caller's profile once, gate on kds.operate, write
-- served_by = v_profile. Signature (mark_item_served(uuid) RETURNS order_items)
-- and the ready-guard (P0011) are unchanged.

CREATE OR REPLACE FUNCTION public.mark_item_served(p_item_id uuid)
 RETURNS order_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_row     order_items;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.has_permission(v_uid, 'kds.operate') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  UPDATE order_items
    SET kitchen_status = 'served',
        served_at      = now(),
        served_by      = v_profile   -- S72 FIX: was auth.uid() → FK violation for real users
    WHERE id = p_item_id
      AND kitchen_status = 'ready'
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Item must be ready before serving' USING ERRCODE = 'P0011';
  END IF;

  RETURN v_row;
END $function$;

-- Anon defense-in-depth trio (S20) — re-asserted.
REVOKE ALL ON FUNCTION public.mark_item_served(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_item_served(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_item_served(uuid) TO authenticated;
