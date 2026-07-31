-- 20260730000004_adr017_d4_fire_counter_order_v5.sql
--
-- ADR-017 décision 4, second chemin — le parcours « envoyer en cuisine puis
-- encaisser ». fire_counter_order calcule le snapshot des ingrédients de
-- modificateurs sans rien déduire ; pay_existing_order déduit ensuite depuis ce
-- snapshot exact, une seule fois. Le snapshot ignorait les combos : le lait
-- d'un café commandé en salle ne sortait jamais du stock.
--
-- pay_existing_order n'a rien à changer : elle relit
-- order_items.modifier_ingredients_deducted, désormais renseigné pour les
-- combos aussi. Void et refund le relisent également, donc la restitution suit.
--
-- PROVENANCE DU CORPS. Repris du fichier 20260710000122 après preuve de
-- non-dérive : md5 du corps normalisé identique au corps en base,
-- 70d21df158f7c40655a56b4382780eb6 sur 6 095 caractères, vérifié le 2026-07-30.
-- Un seul emplacement change.

CREATE OR REPLACE FUNCTION public.fire_counter_order_v5(
  p_client_uuid uuid,
  p_session_id uuid,
  p_items jsonb,
  p_order_id uuid DEFAULT NULL::uuid,
  p_table_number text DEFAULT NULL::text,
  p_order_type order_type DEFAULT 'take_out'::order_type,
  p_discount_authorized_by uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id            UUID := auth.uid();
  v_existing_order_id  UUID;
  v_order_id           UUID := p_order_id;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_product_id         UUID;
  v_quantity           DECIMAL(10,3);
  v_unit_price         DECIMAL(12,2);
  v_modifiers          JSONB;
  v_modifiers_per_unit DECIMAL(12,2);
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

  SELECT order_id INTO v_existing_order_id
    FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF v_existing_order_id IS NOT NULL THEN
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item;
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
    v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

    INSERT INTO orders (
      order_number, order_type, status, created_via, session_id,
      table_number, sent_to_kitchen_at, subtotal, tax_amount, total
    ) VALUES (
      v_order_number, p_order_type, 'pending_payment', 'pos', p_session_id,
      p_table_number, now(), 0, 0, 0
    ) RETURNING id INTO v_order_id;
  ELSE
    SELECT o.order_number INTO v_order_number
      FROM orders o
      WHERE o.id = p_order_id AND o.created_via = 'pos'
        AND o.status = 'pending_payment' AND o.session_id = p_session_id;
    IF v_order_number IS NULL THEN
      RAISE EXCEPTION 'Order not found or not appendable' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id    := (v_item->>'product_id')::UUID;
    v_quantity      := (v_item->>'quantity')::DECIMAL;
    v_unit_price    := (v_item->>'unit_price')::DECIMAL;
    v_modifiers     := COALESCE(v_item->'modifiers', '[]'::jsonb);

    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = v_product_id) THEN
      RAISE EXCEPTION 'Product % not found', v_product_id USING ERRCODE = 'P0002';
    END IF;

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit FROM jsonb_array_elements(v_modifiers) m;

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
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station, dispatch_stations, combo_components,
      discount_amount, is_locked, kitchen_status, sent_to_kitchen_at,
      modifier_ingredients_deducted
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, round_idr(v_modifiers_per_unit * v_quantity), v_dispatch_station, v_dispatch_stations,
      CASE WHEN p.product_type = 'combo'
           THEN COALESCE(v_item->'combo_components', '[]'::jsonb)
           ELSE NULL END,
      v_line_discount, true, 'pending', now(),
      -- Phase 2: persist the resolved modifier-ingredient snapshot (no deduction
      -- at fire; pay_existing_order_v10 deducts from this exact set, once).
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
                                 'rpc_version', 'fire_v4'));
  END IF;

  IF p_discount_authorized_by IS NOT NULL THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.discount_applied', 'orders', v_order_id,
              jsonb_build_object('authorized_by', p_discount_authorized_by,
                                 'source', 'fire_counter_append', 'rpc_version', 'fire_v4'));
  END IF;

  BEGIN
    INSERT INTO counter_fire_idempotency_keys (client_uuid, order_id)
      VALUES (p_client_uuid, v_order_id);
  EXCEPTION WHEN unique_violation THEN
    SELECT order_id INTO v_existing_order_id
      FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item;
  END;

  RETURN jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'idempotent_replay', false);
END $function$;

-- Queue restituée le 2026-07-31. La migration APPLIQUÉE (bookkeeping cloud,
-- version 20260730101635) exécutait après la création de v5 les cinq ordres
-- ci-dessous — DROP de v4, REVOKE PUBLIC/anon, GRANT, COMMENT — que ce fichier
-- avait perdus à l'écriture. Ils sont repris à l'identique de ce qui a tourné :
-- sans eux, tout rejeu de la lignée sur une base neuve laisserait v4 vivante
-- et v5 sans grant.

DROP FUNCTION IF EXISTS public.fire_counter_order_v4(p_client_uuid uuid, p_session_id uuid, p_items jsonb, p_order_id uuid, p_table_number text, p_order_type order_type, p_discount_authorized_by uuid);

REVOKE ALL ON FUNCTION public.fire_counter_order_v5(p_client_uuid uuid, p_session_id uuid, p_items jsonb, p_order_id uuid, p_table_number text, p_order_type order_type, p_discount_authorized_by uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fire_counter_order_v5(p_client_uuid uuid, p_session_id uuid, p_items jsonb, p_order_id uuid, p_table_number text, p_order_type order_type, p_discount_authorized_by uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fire_counter_order_v5(p_client_uuid uuid, p_session_id uuid, p_items jsonb, p_order_id uuid, p_table_number text, p_order_type order_type, p_discount_authorized_by uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fire_counter_order_v5(p_client_uuid uuid, p_session_id uuid, p_items jsonb, p_order_id uuid, p_table_number text, p_order_type order_type, p_discount_authorized_by uuid) IS
  'ADR-017 D4 — v5 = v4 + snapshot des ingredients des modificateurs portes par les composants d''un combo. Aucune deduction au fire : pay_existing_order deduit depuis ce snapshot, une seule fois.';
