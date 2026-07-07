-- 20260710000121_transfer_order_table_v1.sql
-- Fiche 02 D2.5 (exigence propriétaire 2026-07-07) — migration d'une commande vers une
-- autre table, TRACÉE. Le POS pouvait seulement réécrire cart.tableNumber avant le fire ;
-- aucune trace serveur d'un changement de table sur une commande persistée. Ce RPC déplace
-- orders.table_number sur une commande ACTIVE (status hors completed/voided — miroir du
-- prédicat d'occupation useTableOccupancy) et écrit audit_logs 'order.table_transfer'
-- (metadata {order_number, from_table, to_table}) — la traçabilité BO passe par le journal
-- d'audit existant (get_audit_logs_v1/v2), zéro nouvelle surface.
-- Gate pos.sale.create (CASHIER/waiter/MANAGER/ADMIN/SUPER_ADMIN) : le serveur en salle
-- transfère lui-même. Destination validée contre restaurant_tables (active, non supprimée).
-- La destination OCCUPÉE n'est PAS bloquée serveur (deux commandes peuvent déjà partager
-- une table aujourd'hui ; l'UI POS interdit la cible occupée en mode transfert).
-- Money-path non touchée (UPDATE de table_number seul, jamais les montants).

CREATE FUNCTION public.transfer_order_table_v1(
  p_order_id UUID,
  p_to_table TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_profile_id UUID;
  v_order      RECORD;
  v_from_table TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_user_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  IF p_to_table IS NULL OR btrim(p_to_table) = '' THEN
    RAISE EXCEPTION 'to_table required' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock la commande (anti-TOCTOU, pattern S52/S62).
  SELECT id, order_number, status, table_number INTO v_order
    FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Transférable = occupe (potentiellement) une table = miroir du prédicat
  -- d'occupation POS (status NOT IN completed/voided). from_table NULL autorisé :
  -- poser une table sur une commande qui n'en avait pas est un transfert valide.
  IF v_order.status IN ('completed', 'voided') THEN
    RAISE EXCEPTION 'order_not_transferable: status=%', v_order.status
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM restaurant_tables t
    WHERE t.name = p_to_table AND t.is_active AND t.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'table_not_found: %', p_to_table USING ERRCODE = 'P0002';
  END IF;

  v_from_table := v_order.table_number;

  -- No-op idempotent : même table → aucune écriture, aucun bruit d'audit.
  IF v_from_table IS NOT DISTINCT FROM p_to_table THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id, 'order_number', v_order.order_number,
      'from_table', v_from_table, 'to_table', p_to_table, 'noop', true
    );
  END IF;

  UPDATE orders SET table_number = p_to_table, updated_at = now()
    WHERE id = p_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.table_transfer', 'orders', p_order_id,
      jsonb_build_object(
        'order_number', v_order.order_number,
        'from_table',   v_from_table,
        'to_table',     p_to_table
      ));

  RETURN jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'from_table', v_from_table, 'to_table', p_to_table, 'noop', false
  );
END $$;

REVOKE ALL ON FUNCTION public.transfer_order_table_v1(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_order_table_v1(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_table_v1(UUID, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.transfer_order_table_v1(UUID, TEXT) IS
  'Fiche02-D2.5: déplace une commande active (status hors completed/voided) vers une autre '
  'table restaurant_tables active, avec trace audit_logs order.table_transfer {from,to}. '
  'Gate pos.sale.create. Errors: P0002 order_not_found/table_not_found, P0001 '
  'order_not_transferable, P0003 permission. Même table = noop sans audit. Appelé en RPC '
  'direct par le POS (FloorPlanModal mode transfert).';
