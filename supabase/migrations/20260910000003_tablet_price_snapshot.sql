CREATE OR REPLACE FUNCTION public.create_tablet_order_v10(p_client_uuid uuid, p_waiter_id uuid, p_table_number text, p_order_type order_type, p_items jsonb, p_notes text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid, p_tolerate_unsellable boolean DEFAULT false, p_source_code text DEFAULT 'T1'::text, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id            UUID;
  v_actor_profile      UUID;
  v_waiter_id          UUID;
  v_existing_order_id  UUID;
  v_order_id           UUID;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_comp               JSONB;
  v_product_id         UUID;
  v_product_name       TEXT;
  v_product_type       TEXT;
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

  PERFORM pg_advisory_xact_lock(hashtextextended('tablet-order:' || p_client_uuid::text, 0));
  SELECT order_id INTO v_existing_order_id
    FROM tablet_order_idempotency_keys
    WHERE client_uuid = p_client_uuid;

  IF v_existing_order_id IS NOT NULL THEN
    RETURN v_existing_order_id;
  END IF;

  IF p_source_code IS NULL OR p_source_code !~ '^(P|T[0-9]+|BO)$' THEN
    RAISE EXCEPTION 'Invalid source code: %', p_source_code USING ERRCODE = 'check_violation';
  END IF;

  IF NOT has_permission(v_user_id, 'sales.create') THEN
    RAISE EXCEPTION 'Permission denied: sales.create' USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_actor_profile
    FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;

  IF v_actor_profile IS NULL THEN
    RAISE EXCEPTION 'caller_profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_waiter_id := COALESCE(p_waiter_id, v_actor_profile);

  IF v_waiter_id <> v_actor_profile THEN
    RAISE EXCEPTION 'waiter_id_must_match_caller' USING ERRCODE = 'check_violation';
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

    v_order_number := p_source_code || to_char(CURRENT_DATE, 'DDMMYYYY') || LPAD(v_seq_number::TEXT, 3, '0');

    INSERT INTO orders (
      order_number, order_type, status, created_via,
      waiter_id, table_number, sent_to_kitchen_at,
      subtotal, tax_amount, total, notes, customer_id
    ) VALUES (
      v_order_number, p_order_type, 'pending_payment', 'tablet',
      v_waiter_id, p_table_number, now(),
      0, 0, 0, p_notes, p_customer_id
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

    SELECT p.name, p.product_type INTO v_product_name, v_product_type FROM products p WHERE p.id = v_product_id;
    IF v_product_name IS NULL THEN
      RAISE EXCEPTION 'Product % not found', v_product_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT p_tolerate_unsellable THEN
      PERFORM _assert_product_sellable_v1(v_product_id, false);
      FOR v_comp IN
        SELECT * FROM jsonb_array_elements(COALESCE(v_item->'combo_components', '[]'::jsonb))
      LOOP
        PERFORM _assert_product_sellable_v1((v_comp->>'product_id')::UUID, true);
      END LOOP;
    END IF;

    -- v9 — un combo est price serveur (ADR-017, meme resolveur que le
    -- money-path). Sous p_tolerate_unsellable (rejeu hors-ligne, ADR-022
    -- dec. 3) un echec de resolution est rattrape : prix client conserve,
    -- evenement trace. En ligne, l'exception remonte telle quelle.
    IF v_product_type = 'combo' THEN
      BEGIN
        v_unit_price := _resolve_combo_price_v1(v_product_id, COALESCE(v_item->'combo_components', '[]'::jsonb));
      EXCEPTION
        WHEN check_violation OR SQLSTATE 'P0002' THEN
          IF NOT p_tolerate_unsellable THEN
            RAISE;
          END IF;
          INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
            VALUES (v_actor_profile, 'order.combo_price_tolerated', 'orders', v_order_id,
                    jsonb_build_object('rpc_version', 'tablet_v10',
                                       'product_id', v_product_id,
                                       'client_uuid', p_client_uuid,
                                       'client_unit_price', v_unit_price,
                                       'sqlstate', SQLSTATE,
                                       'reason', SQLERRM));
      END;
      -- Miroir de _resolve_line_price_v2 (p_combo) : libelles conserves,
      -- ajustement force a 0 — les surcharges sont deja dans le prix resolu.
      SELECT COALESCE(jsonb_agg(m || jsonb_build_object('price_adjustment', 0)), '[]'::jsonb)
        INTO v_modifiers FROM jsonb_array_elements(v_modifiers) m;
      v_modifiers_per_unit := 0;
    ELSE
      IF p_tolerate_unsellable THEN
        -- Un prix historique déjà engagé ne change pas à la finalisation/reprise.
        SELECT COALESCE(SUM((m->>'price_adjustment')::numeric), 0)
          INTO v_modifiers_per_unit FROM jsonb_array_elements(v_modifiers) m;
      ELSE
        SELECT r.unit_price, r.modifiers_total, r.modifiers_resolved
          INTO v_unit_price, v_modifiers_per_unit, v_modifiers
          FROM _resolve_line_price_v2(v_product_id, v_quantity, v_modifiers,
            COALESCE(p_customer_id, (SELECT customer_id FROM orders WHERE id = v_order_id)), false, false) r;
      END IF;
    END IF;

    v_modifiers_total := round_idr(v_modifiers_per_unit * v_quantity);
    v_line_total      := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);

    v_dispatch_stations := _resolve_dispatch_stations_v1(v_product_id);
    v_dispatch_station  := v_dispatch_stations[1];

    -- v9 — combo_components et modifier_ingredients_deducted persistes, miroir
    -- exact de fire_counter_order_v7 : pay_existing_order lit ces deux colonnes
    -- pour destocker composants et ingredients de modificateurs au paiement.
    INSERT INTO order_items (
      client_line_id, order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station, dispatch_stations,
      combo_components, is_locked, kitchen_status, sent_to_kitchen_at,
      modifier_ingredients_deducted
    ) VALUES (
      NULLIF(v_item->>'client_line_id', ''), v_order_id, v_product_id, v_product_name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch_station, v_dispatch_stations,
      CASE WHEN v_product_type = 'combo'
           THEN COALESCE(v_item->'combo_components', '[]'::jsonb)
           ELSE NULL END,
      true, 'pending', now(),
      CASE WHEN v_product_type <> 'combo'
           THEN NULLIF(_resolve_modifier_ingredients_v1(v_product_id, v_modifiers, v_quantity), '[]'::jsonb)
           ELSE NULLIF(_resolve_combo_modifier_ingredients_v1(v_item->'combo_components', v_quantity), '[]'::jsonb) END
    );

    v_appended_count := v_appended_count + 1;
  END LOOP;

  IF p_order_id IS NOT NULL THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.tablet_appended', 'orders', v_order_id,
              jsonb_build_object('items_added', v_appended_count,
                                 'client_uuid', p_client_uuid,
                                 'source', 'tablet_append'));
  END IF;

  IF p_tolerate_unsellable THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.sellability_tolerated', 'orders', v_order_id,
              jsonb_build_object('rpc_version', 'tablet_v10',
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

REVOKE ALL ON FUNCTION public.create_tablet_order_v10(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tablet_order_v10(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text, uuid) TO authenticated, service_role;
DROP FUNCTION public.create_tablet_order_v9(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text);
