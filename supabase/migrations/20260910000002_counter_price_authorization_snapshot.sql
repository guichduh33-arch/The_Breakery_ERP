CREATE OR REPLACE FUNCTION public.fire_counter_order_v9(p_client_uuid uuid, p_session_id uuid, p_items jsonb, p_order_id uuid DEFAULT NULL::uuid, p_table_number text DEFAULT NULL::text, p_order_type order_type DEFAULT 'take_out'::order_type, p_discount_authorized_by uuid DEFAULT NULL::uuid, p_tolerate_unsellable boolean DEFAULT false, p_source_code text DEFAULT 'P'::text, p_customer_id uuid DEFAULT NULL::uuid, p_discount_auth_id uuid DEFAULT NULL::uuid, p_offline_replay boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id            UUID := auth.uid();
  v_existing_order_id  UUID;
  v_order_id           UUID := p_order_id;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_comp               JSONB;
  v_product_id         UUID;
  v_product_type       TEXT;
  v_quantity           DECIMAL(10,3);
  v_unit_price         DECIMAL(12,2);
  v_modifiers          JSONB;
  v_modifiers_per_unit DECIMAL(12,2);
  v_comp_mod_adj       DECIMAL(12,2);
  v_line_gross         DECIMAL(12,2);
  v_line_discount      DECIMAL(12,2);
  v_line_total         DECIMAL(12,2);
  v_dispatch_station   TEXT;
  v_dispatch_stations  TEXT[];
  v_authorizer_uid     UUID;
  v_actor_profile      UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid required' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('counter-fire:' || p_client_uuid::text, 0));

  SELECT order_id INTO v_existing_order_id
    FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF v_existing_order_id IS NOT NULL THEN
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item || get_pos_order_snapshot_v1(v_existing_order_id);
  END IF;

  -- Numérotation par origine : validé après le replay d'idempotence.
  IF p_source_code IS NULL OR p_source_code !~ '^(P|T[0-9]+|BO)$' THEN
    RAISE EXCEPTION 'Invalid source code: %', p_source_code USING ERRCODE = 'check_violation';
  END IF;

  IF NOT has_permission(v_user_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Fire must contain at least one item' USING ERRCODE = 'check_violation';
  END IF;
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id required for counter orders' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) it
    WHERE COALESCE((it->>'discount_amount')::DECIMAL(12,2), 0) > 0
  ) THEN
    IF p_discount_authorized_by IS NULL THEN
      RAISE EXCEPTION 'Discount requires an authorizing manager' USING ERRCODE = 'check_violation';
    END IF;
    SELECT up.auth_user_id INTO v_authorizer_uid
      FROM user_profiles up
      WHERE up.id = p_discount_authorized_by AND up.deleted_at IS NULL;
    IF v_authorizer_uid IS NULL THEN
      RAISE EXCEPTION 'Discount authorizer not found' USING ERRCODE = 'P0003';
    END IF;
    IF NOT has_permission(v_authorizer_uid, 'sales.discount') THEN
      RAISE EXCEPTION 'Authorizer lacks permission: sales.discount' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF p_offline_replay AND NOT p_tolerate_unsellable THEN
    RAISE EXCEPTION 'Offline replay requires explicit tolerance' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i WHERE COALESCE((i->>'discount_amount')::numeric, 0) > 0)
     AND NOT p_offline_replay THEN
    UPDATE discount_authorizations SET consumed_at = now()
      WHERE id = p_discount_auth_id AND scope = 'discount'
        AND manager_profile_id = p_discount_authorized_by
        AND consumed_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid manager PIN for discount authorization' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_order_id IS NULL THEN
    -- Fiche02-D2.5 (1) : table obligatoire à la CRÉATION d'une commande dine-in.
    -- L'UI POS garde en amont (useDineInTableGuard) ; ceci est le filet serveur.
    IF p_order_type = 'dine_in' AND (p_table_number IS NULL OR btrim(p_table_number) = '') THEN
      RAISE EXCEPTION 'table_required_for_dine_in' USING ERRCODE = 'P0011';
    END IF;

    INSERT INTO order_sequences (date, last_number)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE SET last_number = order_sequences.last_number + 1
      RETURNING last_number INTO v_seq_number;
    -- Numérotation par origine : <code><DDMMYYYY><NNN>, séquence quotidienne
    -- partagée entre toutes les portes.
    v_order_number := p_source_code || to_char(CURRENT_DATE, 'DDMMYYYY') || LPAD(v_seq_number::TEXT, 3, '0');

    INSERT INTO orders (
      order_number, order_type, status, created_via, session_id,
      table_number, sent_to_kitchen_at, subtotal, tax_amount, total, customer_id
    ) VALUES (
      v_order_number, p_order_type, 'pending_payment', 'pos', p_session_id,
      p_table_number, now(), 0, 0, 0, p_customer_id
    ) RETURNING id INTO v_order_id;
  ELSE
    SELECT o.order_number INTO v_order_number
      FROM orders o
      WHERE o.id = p_order_id AND o.created_via = 'pos'
        AND o.status = 'pending_payment' AND o.session_id = p_session_id FOR UPDATE;
    IF v_order_number IS NULL THEN
      RAISE EXCEPTION 'Order not found or not appendable' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id    := (v_item->>'product_id')::UUID;
    v_quantity      := (v_item->>'quantity')::DECIMAL;
    v_unit_price    := (v_item->>'unit_price')::DECIMAL;
    v_modifiers     := COALESCE(v_item->'modifiers', '[]'::jsonb);

    -- L'existence reste verifiee INCONDITIONNELLEMENT : l'INSERT ci-dessous lit
    -- `FROM products WHERE id = v_product_id` et insererait zero ligne en silence.
    -- v8 : product_type lu au passage (TEXT NOT NULL sous CHECK finished|combo),
    -- la branche prix combo en a besoin avant l'INSERT.
    SELECT p.product_type INTO v_product_type FROM products p WHERE p.id = v_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found', v_product_id USING ERRCODE = 'P0002';
    END IF;

    -- ADR-022 dec. 1 : meme regle de vendabilite que le money-path, sur la ligne
    -- comme sur chaque composant de combo (ADR-012 dec. 1). Dec. 3 : sautee
    -- uniquement sur rejeu hors-ligne ou appoint de checkout, ou le refus
    -- arriverait trop tard.
    IF NOT p_tolerate_unsellable THEN
      PERFORM _assert_product_sellable_v1(v_product_id, false);
      FOR v_comp IN
        SELECT * FROM jsonb_array_elements(COALESCE(v_item->'combo_components', '[]'::jsonb))
      LOOP
        PERFORM _assert_product_sellable_v1((v_comp->>'product_id')::UUID, true);
      END LOOP;
    END IF;

    -- v8 — un combo est price serveur (ADR-017, meme resolveur que le
    -- money-path et que la tablette). Sous p_tolerate_unsellable (rejeu
    -- hors-ligne / appoint du checkout, ADR-022 dec. 3) un echec de resolution
    -- est rattrape : la ligne est facturee ce que la caisse a facture (prix
    -- client + surcharges de ligne + ajustements des modificateurs de
    -- composants), evenement trace. En ligne, l'exception remonte telle quelle.
    IF v_product_type = 'combo' THEN
      BEGIN
        v_unit_price := _resolve_combo_price_v1(v_product_id, COALESCE(v_item->'combo_components', '[]'::jsonb));
      EXCEPTION
        WHEN check_violation OR SQLSTATE 'P0002' THEN
          IF NOT p_tolerate_unsellable THEN
            RAISE;
          END IF;
          SELECT COALESCE(SUM(COALESCE((m->>'price_adjustment')::DECIMAL(12,2), 0)), 0)
            INTO v_modifiers_per_unit FROM jsonb_array_elements(v_modifiers) m;
          SELECT COALESCE(SUM(COALESCE((cm->>'price_adjustment')::DECIMAL(12,2), 0)), 0)
            INTO v_comp_mod_adj
            FROM jsonb_array_elements(COALESCE(v_item->'combo_components', '[]'::jsonb)) c
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(c->'modifiers') = 'array' THEN c->'modifiers' ELSE '[]'::jsonb END) cm;
          SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
          INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
            VALUES (v_actor_profile, 'order.combo_price_tolerated', 'orders', v_order_id,
                    jsonb_build_object('rpc_version', 'fire_v9',
                                       'product_id', v_product_id,
                                       'client_uuid', p_client_uuid,
                                       'client_unit_price', v_unit_price,
                                       'tolerated_unit_price', v_unit_price + v_modifiers_per_unit + v_comp_mod_adj,
                                       'sqlstate', SQLSTATE,
                                       'reason', SQLERRM));
          v_unit_price := v_unit_price + v_modifiers_per_unit + v_comp_mod_adj;
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

    v_line_gross := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);
    v_line_discount := LEAST(
      GREATEST(COALESCE((v_item->>'discount_amount')::DECIMAL(12,2), 0), 0),
      v_line_gross
    );
    v_line_total := v_line_gross - v_line_discount;

    -- Spec B-1 Ph2 — résolution multi-station (override produit > catégorie).
    v_dispatch_stations := _resolve_dispatch_stations_v1(v_product_id);
    v_dispatch_station  := v_dispatch_stations[1];  -- legacy single = 1er élément (NULL si vide)

    INSERT INTO order_items (
      client_line_id, order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station, dispatch_stations, combo_components,
      discount_amount, is_locked, kitchen_status, sent_to_kitchen_at,
      modifier_ingredients_deducted
    )
    SELECT
      NULLIF(v_item->>'client_line_id', ''), v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, round_idr(v_modifiers_per_unit * v_quantity), v_dispatch_station, v_dispatch_stations,
      CASE WHEN p.product_type = 'combo'
           THEN COALESCE(v_item->'combo_components', '[]'::jsonb)
           ELSE NULL END,
      v_line_discount, true, 'pending', now(),
      -- Phase 2: persist the resolved modifier-ingredient snapshot (no deduction
      -- at fire; pay_existing_order deducts from this exact set, once).
      CASE WHEN p.product_type <> 'combo'
           THEN NULLIF(_resolve_modifier_ingredients_v1(p.id, v_modifiers, v_quantity), '[]'::jsonb)
           ELSE NULLIF(_resolve_combo_modifier_ingredients_v1(v_item->'combo_components', v_quantity), '[]'::jsonb) END
    FROM products p WHERE p.id = v_product_id;
  END LOOP;

  -- Fiche02-D2.5 (2) : fire sur commande EXISTANTE = « adding order » — trace DB.
  IF p_order_id IS NOT NULL THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.fire_appended', 'orders', v_order_id,
              jsonb_build_object('order_number', v_order_number,
                                 'items_count', jsonb_array_length(p_items),
                                 'table_number', (SELECT o.table_number FROM orders o WHERE o.id = v_order_id),
                                 'rpc_version', 'fire_v9'));
  END IF;

  -- ADR-022 dec. 3 : la tolerance est un evenement, jamais un defaut. Elle se
  -- relit dans audit_logs, comme le p_offline_replay de pay_existing_order.
  IF p_tolerate_unsellable THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.sellability_tolerated', 'orders', v_order_id,
              jsonb_build_object('rpc_version', 'fire_v9',
                                 'tolerate_unsellable', true,
                                 'items_count', jsonb_array_length(p_items),
                                 'client_uuid', p_client_uuid));
  END IF;

  IF p_discount_authorized_by IS NOT NULL THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.discount_applied', 'orders', v_order_id,
              jsonb_build_object('authorized_by', p_discount_authorized_by,
                                 'source', 'fire_counter_append', 'rpc_version', 'fire_v9'));
  END IF;

  BEGIN
    INSERT INTO counter_fire_idempotency_keys (client_uuid, order_id)
      VALUES (p_client_uuid, v_order_id);
  EXCEPTION WHEN unique_violation THEN
    SELECT order_id INTO v_existing_order_id
      FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item || get_pos_order_snapshot_v1(v_existing_order_id);
  END;

  IF p_discount_auth_id IS NOT NULL THEN
    UPDATE discount_authorizations SET consumed_order_id = v_order_id
      WHERE id = p_discount_auth_id AND consumed_at IS NOT NULL;
  END IF;
  IF p_offline_replay THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
      VALUES(v_actor_profile, 'order.offline_fire_replayed', 'orders', v_order_id,
        jsonb_build_object('client_uuid', p_client_uuid, 'legacy_discount', p_discount_authorized_by IS NOT NULL));
  END IF;
  RETURN get_pos_order_snapshot_v1(v_order_id) || jsonb_build_object('idempotent_replay', false);
END $function$;

REVOKE ALL ON FUNCTION public.fire_counter_order_v9(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fire_counter_order_v9(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text, uuid, uuid, boolean) TO authenticated, service_role;
DROP FUNCTION public.fire_counter_order_v8(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text);
