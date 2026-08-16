-- 20260816000003_bump_create_tablet_order_v7_source_numbering.sql
-- Numérotation par origine (voir 20260816000001) — porte tablette.
-- v7 = v6 (corps live pg_get_functiondef, verbatim) + p_source_code text DEFAULT 'T1'
-- (chaque tablette envoie son identifiant T1/T2/… depuis ses réglages appareil)
-- + format <code><DDMMYYYY><NNN> ; label rpc_version tablet_v6 → tablet_v7.

CREATE OR REPLACE FUNCTION public.create_tablet_order_v7(p_client_uuid uuid, p_waiter_id uuid, p_table_number text, p_order_type order_type, p_items jsonb, p_notes text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid, p_tolerate_unsellable boolean DEFAULT false, p_source_code text DEFAULT 'T1')
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id            UUID;
  v_actor_profile      UUID;
  v_existing_order_id  UUID;
  v_order_id           UUID;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_comp               JSONB;
  v_product_id         UUID;
  v_product_name       TEXT;
  v_quantity           DECIMAL(10,3);
  v_unit_price         DECIMAL(12,2);
  v_modifiers          JSONB;
  v_modifiers_per_unit DECIMAL(12,2);
  v_modifiers_total    DECIMAL(12,2);
  v_line_total         DECIMAL(12,2);
  v_dispatch_station   TEXT;
  v_dispatch_stations  TEXT[];
  v_appended_count     INTEGER := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT order_id INTO v_existing_order_id
    FROM tablet_order_idempotency_keys
    WHERE client_uuid = p_client_uuid;

  IF v_existing_order_id IS NOT NULL THEN
    RETURN v_existing_order_id;
  END IF;

  -- Numérotation par origine : validé après le replay d'idempotence.
  IF p_source_code IS NULL OR p_source_code !~ '^(P|T[0-9]+|BO)$' THEN
    RAISE EXCEPTION 'Invalid source code: %', p_source_code USING ERRCODE = 'check_violation';
  END IF;

  IF NOT has_permission(v_user_id, 'sales.create') THEN
    RAISE EXCEPTION 'Permission denied: sales.create' USING ERRCODE = 'P0003';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item' USING ERRCODE = 'check_violation';
  END IF;

  IF p_order_id IS NULL THEN
    IF p_order_type = 'dine_in' AND (p_table_number IS NULL OR btrim(p_table_number) = '') THEN
      RAISE EXCEPTION 'table_required_for_dine_in' USING ERRCODE = 'P0011';
    END IF;

    INSERT INTO order_sequences (date, last_number)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE
        SET last_number = order_sequences.last_number + 1
      RETURNING last_number INTO v_seq_number;

    -- Numérotation par origine : <code><DDMMYYYY><NNN>, séquence quotidienne
    -- partagée entre toutes les portes.
    v_order_number := p_source_code || to_char(CURRENT_DATE, 'DDMMYYYY') || LPAD(v_seq_number::TEXT, 3, '0');

    INSERT INTO orders (
      order_number, order_type, status, created_via,
      waiter_id, table_number, sent_to_kitchen_at,
      subtotal, tax_amount, total, notes
    ) VALUES (
      v_order_number, p_order_type, 'pending_payment', 'tablet',
      p_waiter_id, p_table_number, now(),
      0, 0, 0, p_notes
    ) RETURNING id INTO v_order_id;
  ELSE
    SELECT o.id INTO v_order_id
      FROM orders o
      WHERE o.id = p_order_id
        AND o.created_via = 'tablet'
        AND o.status IN ('pending_payment', 'draft')
      FOR UPDATE;

    IF v_order_id IS NULL THEN
      RAISE EXCEPTION 'Order not found or not appendable' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    -- Existence : inconditionnelle, v_product_name alimente le name_snapshot.
    SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
    IF v_product_name IS NULL THEN
      RAISE EXCEPTION 'Product % not found', v_product_id USING ERRCODE = 'P0002';
    END IF;

    -- ADR-022 dec. 1 et 3 — voir fire_counter_order_v7. Les composants de combo
    -- sont valides meme si cette porte ne les persiste pas encore : la garde
    -- porte sur ce que la caisse a saisi.
    IF NOT p_tolerate_unsellable THEN
      PERFORM _assert_product_sellable_v1(v_product_id, false);
      FOR v_comp IN
        SELECT * FROM jsonb_array_elements(COALESCE(v_item->'combo_components', '[]'::jsonb))
      LOOP
        PERFORM _assert_product_sellable_v1((v_comp->>'product_id')::UUID, true);
      END LOOP;
    END IF;

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_modifiers_total := round_idr(v_modifiers_per_unit * v_quantity);
    v_line_total      := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);

    v_dispatch_stations := _resolve_dispatch_stations_v1(v_product_id);
    v_dispatch_station  := v_dispatch_stations[1];

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station, dispatch_stations,
      is_locked, kitchen_status, sent_to_kitchen_at
    ) VALUES (
      v_order_id, v_product_id, v_product_name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch_station, v_dispatch_stations,
      true, 'pending', now()
    );

    v_appended_count := v_appended_count + 1;
  END LOOP;

  IF p_order_id IS NOT NULL THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.tablet_appended', 'orders', v_order_id,
              jsonb_build_object('items_added', v_appended_count,
                                 'client_uuid', p_client_uuid,
                                 'source', 'tablet_append'));
  END IF;

  IF p_tolerate_unsellable THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.sellability_tolerated', 'orders', v_order_id,
              jsonb_build_object('rpc_version', 'tablet_v7',
                                 'tolerate_unsellable', true,
                                 'items_count', jsonb_array_length(p_items),
                                 'client_uuid', p_client_uuid));
  END IF;

  BEGIN
    INSERT INTO tablet_order_idempotency_keys (client_uuid, order_id)
      VALUES (p_client_uuid, v_order_id);
  EXCEPTION WHEN unique_violation THEN
    SELECT order_id INTO v_existing_order_id
      FROM tablet_order_idempotency_keys
      WHERE client_uuid = p_client_uuid;
    RETURN v_existing_order_id;
  END;

  RETURN v_order_id;
END $function$;

DROP FUNCTION IF EXISTS public.create_tablet_order_v6(uuid, uuid, text, order_type, jsonb, text, uuid, boolean);

REVOKE ALL     ON FUNCTION public.create_tablet_order_v7(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_tablet_order_v7(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_tablet_order_v7(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.create_tablet_order_v7(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text) IS
  'v7 = v6 + numérotation par origine : p_source_code (défaut T1, la tablette envoie son identifiant depuis ses réglages) + format <code><DDMMYYYY><NNN> sur la séquence quotidienne partagée order_sequences. Aucun autre changement de comportement.';
