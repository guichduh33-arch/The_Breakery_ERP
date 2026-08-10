-- 20260810000005_fix_kds_audit_actor_id.sql
--
-- Les quatre RPC du KDS écrivaient `auth.uid()` dans `audit_logs.actor_id`.
-- Or `audit_logs_actor_id_fkey` référence `user_profiles(id)`, et `auth.uid()`
-- vaut un `user_profiles.auth_user_id` : deux identifiants distincts dès qu'un
-- profil n'a pas été créé par un seed. `create_user_v*`
-- (20260517000200_create_user_rpcs.sql) insère sans fixer `id`, qui prend donc
-- son défaut `gen_random_uuid()` — TOUT compte créé par le back-office a
-- `id <> auth_user_id`.
--
-- Conséquence pour ces comptes : l'INSERT dans audit_logs violait la clé
-- étrangère et faisait échouer le geste entier. Les quatre actions du KDS
-- (bump d'une ligne, « All ready », rappel, annulation de bump) étaient donc
-- inopérantes pour tout opérateur réel — seuls les comptes seed, où les deux
-- identifiants coïncident, fonctionnaient.
--
-- Correction : résoudre le profil acteur AVANT l'écriture, par la même clause
-- que `has_permission` (`auth_user_id = auth.uid() AND deleted_at IS NULL`),
-- déjà exécutée par le gate de permission en tête de chaque fonction — le
-- profil est donc garanti présent quand on l'atteint.
--
-- Corps repris de `pg_get_functiondef` sur la base live ; seuls la déclaration
-- `v_actor`, sa résolution et la valeur insérée dans `actor_id` changent.

-- ---------------------------------------------------------------------------
-- kds_bump_item_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kds_bump_item_v2(p_order_item_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS order_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row     order_items;
  v_now     TIMESTAMPTZ := NOW();
  v_replay  BOOLEAN := FALSE;
  v_actor   UUID;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  SELECT id INTO v_actor
    FROM user_profiles
   WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
   LIMIT 1;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT TRUE INTO v_replay
      FROM audit_logs
     WHERE action = 'kds.bump_item'
       AND entity_type = 'order_item'
       AND entity_id = p_order_item_id
       AND metadata ? 'idempotency_key'
       AND metadata->>'idempotency_key' = p_idempotency_key::TEXT
     LIMIT 1;
    IF v_replay THEN
      SELECT * INTO v_row FROM order_items WHERE id = p_order_item_id;
      RETURN v_row;
    END IF;
  END IF;

  UPDATE order_items
     SET kitchen_status = 'ready',
         ready_at       = v_now,
         bumped_at      = v_now
   WHERE id = p_order_item_id
     AND kitchen_status = 'preparing'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Item must be preparing before bumping to ready'
      USING ERRCODE = 'P0011';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_actor,
      'kds.bump_item',
      'order_item',
      p_order_item_id,
      jsonb_build_object(
        'idempotency_key', p_idempotency_key::TEXT,
        'bumped_at',       v_now
      )
    );
  END IF;

  RETURN v_row;
END $function$;

REVOKE ALL ON FUNCTION public.kds_bump_item_v2(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kds_bump_item_v2(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.kds_bump_item_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kds_bump_item_v2(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.kds_bump_item_v2(uuid, uuid) IS
  'Phase 4.B : bumps an order_item from preparing->ready. Sets ready_at + bumped_at = NOW(). Raises P0011 if not currently preparing. Idempotency via p_idempotency_key (replay returns current row). v2 : actor_id resolved from user_profiles (v1 wrote auth.uid(), violating audit_logs_actor_id_fkey).';

DROP FUNCTION IF EXISTS public.kds_bump_item_v1(uuid, uuid);

-- ---------------------------------------------------------------------------
-- kds_bump_order_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kds_bump_order_v2(p_order_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count  INTEGER;
  v_replay INTEGER;
  v_actor  UUID;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order not found: %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  SELECT id INTO v_actor
    FROM user_profiles
   WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
   LIMIT 1;

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
      v_actor,
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

REVOKE ALL ON FUNCTION public.kds_bump_order_v2(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kds_bump_order_v2(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.kds_bump_order_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kds_bump_order_v2(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.kds_bump_order_v2(uuid, uuid) IS
  'S60 (04 D1.2) - KDS "All ready": bumps all live pending/preparing items of an order to ready in one atomic UPDATE. Gate kds.operate. Idempotent replay via audit_logs kds.bump_order (mirrors the kds_bump_item pattern; audit write skipped when no idempotency key is supplied). v2 : actor_id resolved from user_profiles (v1 wrote auth.uid(), violating audit_logs_actor_id_fkey).';

DROP FUNCTION IF EXISTS public.kds_bump_order_v1(uuid, uuid);

-- ---------------------------------------------------------------------------
-- kds_recall_order_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kds_recall_order_v2(p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
  v_actor UUID;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order not found: %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  SELECT id INTO v_actor
    FROM user_profiles
   WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
   LIMIT 1;

  UPDATE order_items
     SET kitchen_status = 'preparing',
         served_at      = NULL,
         served_by      = NULL,
         ready_at       = NULL,
         bumped_at      = NULL
   WHERE order_id = p_order_id
     AND kitchen_status = 'served';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor,
    'kds.recall',
    'order',
    p_order_id,
    jsonb_build_object(
      'reason',          COALESCE(p_reason, ''),
      'items_recalled',  v_count,
      'recalled_at',     NOW()
    )
  );

  RETURN v_count;
END $function$;

REVOKE ALL ON FUNCTION public.kds_recall_order_v2(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kds_recall_order_v2(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.kds_recall_order_v2(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kds_recall_order_v2(uuid, text) TO service_role;

COMMENT ON FUNCTION public.kds_recall_order_v2(uuid, text) IS
  'Phase 4.B : recalls served items of an order back to preparing. Returns count of items recalled. Logs to audit_logs (action=kds.recall). Gated on has_permission(auth.uid(), kds.operate). v2 : actor_id resolved from user_profiles (v1 wrote auth.uid(), violating audit_logs_actor_id_fkey).';

DROP FUNCTION IF EXISTS public.kds_recall_order_v1(uuid, text);

-- ---------------------------------------------------------------------------
-- kds_undo_bump_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kds_undo_bump_v2(p_order_item_id uuid)
 RETURNS order_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row   order_items;
  v_actor UUID;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM order_items WHERE id = p_order_item_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'order_item not found: %', p_order_item_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_row.kitchen_status <> 'ready' THEN
    RAISE EXCEPTION 'Item must be ready to undo bump'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_row.bumped_at IS NULL
     OR NOW() - v_row.bumped_at > INTERVAL '60 seconds' THEN
    RAISE EXCEPTION 'kds_undo_window_expired'
      USING ERRCODE = 'P0012',
            DETAIL  = format('bumped_at=%s, now=%s', v_row.bumped_at, NOW());
  END IF;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  SELECT id INTO v_actor
    FROM user_profiles
   WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
   LIMIT 1;

  UPDATE order_items
     SET kitchen_status = 'preparing',
         ready_at       = NULL,
         bumped_at      = NULL
   WHERE id = p_order_item_id
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor,
    'kds.undo_bump',
    'order_item',
    p_order_item_id,
    jsonb_build_object('undone_at', NOW())
  );

  RETURN v_row;
END $function$;

REVOKE ALL ON FUNCTION public.kds_undo_bump_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kds_undo_bump_v2(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.kds_undo_bump_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kds_undo_bump_v2(uuid) TO service_role;

COMMENT ON FUNCTION public.kds_undo_bump_v2(uuid) IS
  'Phase 4.B : within 60s of bumped_at, transitions ready->preparing. Raises P0012 (kds_undo_window_expired) if window passed or bumped_at is NULL. v2 : actor_id resolved from user_profiles (v1 wrote auth.uid(), violating audit_logs_actor_id_fkey).';

DROP FUNCTION IF EXISTS public.kds_undo_bump_v1(uuid);
