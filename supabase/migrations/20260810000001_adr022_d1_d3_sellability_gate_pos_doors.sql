-- 20260810000001_adr022_d1_d3_sellability_gate_pos_doors.sql
--
-- ADR-022 décisions 1 et 3 — la définition de « vendable » devient unique et
-- opposable à toutes les portes de vente POS.
--
-- CONSTAT (vérifié sur les corps live le 2026-08-10). La garde construite par
-- l'ADR-011 déc. 2 puis l'ADR-012 déc. 1 ne vivait que dans
-- complete_order_with_payment. Les deux autres portes du POS étaient nettement
-- plus permissives : fire_counter_order et create_tablet_order ne vérifiaient
-- que l'EXISTENCE du produit. Le parcours comptoir → paiement différé échappait
-- donc entièrement à la garde, et pay_existing_order, qui encaisse ce que ces
-- portes ont écrit, ne revalide rien.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. Crée _assert_product_sellable_v1, seul dépositaire de la règle. Son corps
--      et ses messages sont repris MOT POUR MOT de complete_order_with_payment_v24
--      (garde de ligne et garde de composant de combo), afin que le mapping
--      d'erreurs côté client reste valable sur les trois portes. Deux
--      définitions de « vendable » qui coexistent ne sont pas une nuance : la
--      plus permissive gagne toujours.
--   2. fire_counter_order_v5 → v6 et create_tablet_order_v5 → v6 : garde sur la
--      ligne ET sur chaque composant de combo, plus le drapeau de tolérance.
--
-- LE DRAPEAU p_tolerate_unsellable (décision 3). Deux chemins voient le refus
-- arriver TROP TARD — le rejeu hors-ligne (la marchandise est partie, l'argent
-- est perçu) et l'appel d'appoint qui pousse les dernières lignes du panier au
-- moment du checkout (le client est devant la caisse). Un refus n'y protège plus
-- rien et n'y produit qu'un blocage. Le drapeau est explicite, tracé dans
-- audit_logs, et n'est JAMAIS posé par défaut : un appel qui ne relève ni du
-- rejeu ni de la finalisation se voit opposer la garde. Même mécanique que le
-- p_offline_replay de pay_existing_order_v17.
--
-- CE QUI NE CHANGE PAS. Le stock épuisé reste toléré (ADR-011 déc. 2) : la vente
-- hors-ligne peut légitimement diverger du stock cloud jusqu'au rejeu. Le
-- contrôle d'EXISTENCE reste inconditionnel, drapeau ou non — l'INSERT des deux
-- RPC lit `FROM products WHERE id = …`, un produit absent y insérerait
-- silencieusement zéro ligne.
--
-- PROVENANCE DES CORPS. fire_counter_order_v5 et create_tablet_order_v5 repris
-- de pg_get_functiondef sur ikcyvlovptebroadgtvd le 2026-08-10 (8 249 et 5 155
-- caractères). Seuls les emplacements décrits ci-dessus changent.

-- ---------------------------------------------------------------------------
-- 1. Le dépositaire unique de la règle de vendabilité
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._assert_product_sellable_v1(
  p_product_id uuid,
  p_is_combo_component boolean DEFAULT false
)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name      TEXT;
  v_is_active BOOLEAN;
  v_deleted   TIMESTAMPTZ;
BEGIN
  SELECT p.name, p.is_active, p.deleted_at
    INTO v_name, v_is_active, v_deleted
    FROM products p
   WHERE p.id = p_product_id;

  IF NOT FOUND THEN
    IF p_is_combo_component THEN
      RAISE EXCEPTION 'Combo component not found: %', p_product_id USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'Product not found: %', p_product_id USING ERRCODE = 'P0002';
  END IF;

  -- Soft-deleted : volontairement indistinct de l'introuvable sur la ligne
  -- (repris de v24), et fondu dans le message « desactive » sur un composant.
  IF p_is_combo_component THEN
    IF v_deleted IS NOT NULL OR NOT v_is_active THEN
      RAISE EXCEPTION 'product_inactive: composant de combo % desactive', v_name
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF v_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'Product not found: %', p_product_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_is_active THEN
      RAISE EXCEPTION 'product_inactive: % est desactive - retirez-le du panier', v_name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Un produit-parent d'un groupe de variantes ne se vend pas : on vend une
  -- variante. Le parent est reconnu par l'existence d'au moins un enfant vivant.
  IF EXISTS (
    SELECT 1 FROM products c
     WHERE c.parent_product_id = p_product_id
       AND c.is_active
       AND c.deleted_at IS NULL
  ) THEN
    IF p_is_combo_component THEN
      RAISE EXCEPTION 'product_is_parent: composant de combo % est un groupe de variantes - selectionnez une variante', v_name
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'product_is_parent: % est un groupe de variantes - selectionnez une variante', v_name
      USING ERRCODE = 'check_violation';
  END IF;
END $function$;

-- Helper interne : appelé exclusivement depuis des RPC SECURITY DEFINER, qui
-- s'exécutent sous leur propriétaire (postgres) et n'ont donc besoin d'aucun
-- grant ici. Le REVOKE d'`authenticated` n'est pas décoratif : les default
-- privileges de Supabase le grantent d'office sur toute fonction neuve du
-- schéma public, et REVOKE FROM PUBLIC ne l'enlève pas.
REVOKE ALL ON FUNCTION public._assert_product_sellable_v1(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._assert_product_sellable_v1(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public._assert_product_sellable_v1(uuid, boolean) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._assert_product_sellable_v1(uuid, boolean) IS
  'ADR-022 dec. 1 — depositaire UNIQUE de la regle de vendabilite (soft-deleted, desactive, parent d''un groupe de variantes). Corps repris de complete_order_with_payment_v24. p_is_combo_component bascule sur les messages de composant (ADR-012 dec. 1). Le stock epuise reste tolere (ADR-011 dec. 2).';

-- ---------------------------------------------------------------------------
-- 2. fire_counter_order_v5 → v6 — porte comptoir
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fire_counter_order_v6(
  p_client_uuid uuid,
  p_session_id uuid,
  p_items jsonb,
  p_order_id uuid DEFAULT NULL::uuid,
  p_table_number text DEFAULT NULL::text,
  p_order_type order_type DEFAULT 'take_out'::order_type,
  p_discount_authorized_by uuid DEFAULT NULL::uuid,
  p_tolerate_unsellable boolean DEFAULT false
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
  v_comp               JSONB;
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

    -- L'existence reste verifiee INCONDITIONNELLEMENT : l'INSERT ci-dessous lit
    -- `FROM products WHERE id = v_product_id` et insererait zero ligne en silence.
    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = v_product_id) THEN
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
                                 'rpc_version', 'fire_v6'));
  END IF;

  -- ADR-022 dec. 3 : la tolerance est un evenement, jamais un defaut. Elle se
  -- relit dans audit_logs, comme le p_offline_replay de pay_existing_order.
  IF p_tolerate_unsellable THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.sellability_tolerated', 'orders', v_order_id,
              jsonb_build_object('rpc_version', 'fire_v6',
                                 'tolerate_unsellable', true,
                                 'items_count', jsonb_array_length(p_items),
                                 'client_uuid', p_client_uuid));
  END IF;

  IF p_discount_authorized_by IS NOT NULL THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.discount_applied', 'orders', v_order_id,
              jsonb_build_object('authorized_by', p_discount_authorized_by,
                                 'source', 'fire_counter_append', 'rpc_version', 'fire_v6'));
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

DROP FUNCTION IF EXISTS public.fire_counter_order_v5(p_client_uuid uuid, p_session_id uuid, p_items jsonb, p_order_id uuid, p_table_number text, p_order_type order_type, p_discount_authorized_by uuid);

REVOKE ALL ON FUNCTION public.fire_counter_order_v6(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fire_counter_order_v6(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fire_counter_order_v6(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fire_counter_order_v6(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean) IS
  'ADR-022 dec. 1 et 3 — v6 = v5 + garde de vendabilite (_assert_product_sellable_v1) sur la ligne et sur chaque composant de combo, + p_tolerate_unsellable pour le rejeu hors-ligne et l''appoint de checkout, trace dans audit_logs. L''existence du produit reste verifiee inconditionnellement.';

-- ---------------------------------------------------------------------------
-- 3. create_tablet_order_v5 → v6 — porte salle
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_tablet_order_v6(
  p_client_uuid uuid,
  p_waiter_id uuid,
  p_table_number text,
  p_order_type order_type,
  p_items jsonb,
  p_notes text DEFAULT NULL::text,
  p_order_id uuid DEFAULT NULL::uuid,
  p_tolerate_unsellable boolean DEFAULT false
)
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

    v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

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

    -- ADR-022 dec. 1 et 3 — voir fire_counter_order_v6. Les composants de combo
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
              jsonb_build_object('rpc_version', 'tablet_v6',
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

DROP FUNCTION IF EXISTS public.create_tablet_order_v5(uuid, uuid, text, order_type, jsonb, text, uuid);

REVOKE ALL     ON FUNCTION public.create_tablet_order_v6(uuid, uuid, text, order_type, jsonb, text, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_tablet_order_v6(uuid, uuid, text, order_type, jsonb, text, uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_tablet_order_v6(uuid, uuid, text, order_type, jsonb, text, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.create_tablet_order_v6(uuid, uuid, text, order_type, jsonb, text, uuid, boolean) IS
  'ADR-022 dec. 1 et 3 — v6 = v5 + garde de vendabilite (_assert_product_sellable_v1) sur la ligne et sur chaque composant de combo, + p_tolerate_unsellable pour le rejeu hors-ligne, trace dans audit_logs. Cree (p_order_id NULL) ou AJOUTE des lignes a une commande tablette encore ouverte. Produit introuvable -> P0002. Idempotent par client_uuid.';
