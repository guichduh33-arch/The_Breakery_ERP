-- 20260901000011_fire_counter_order_v8_combo_server_price.sql
--
-- Audit lot 1 du 2026-08-31 (docs/audits/2026-08-31-audit-pos-flow.md, volet
-- « prix » du P0 n°6) — décision 6 de Mamat du 2026-09-05 : « fire_counter_order
-- (prix combo serveur côté caisse) : lot séparé, après le lot tablette, avec sa
-- conception de replay dégradé ». Le lot tablette (create_tablet_order_v9,
-- 20260901000010) est livré ; celui-ci ferme le troisième et dernier chemin
-- d'argent qui prenait encore le prix d'un combo tel quel du client.
--
-- `fire_counter_order_v7` valide la vendabilité des composants (ADR-022) et
-- persiste `combo_components` + `modifier_ingredients_deducted`, mais prend
-- `v_unit_price := (v_item->>'unit_price')::DECIMAL` du client et ne consulte
-- jamais `_resolve_combo_price_v1` : ni les groupes de composants, ni les
-- surcharges, ni les ajustements des modificateurs de composants (ADR-017) ne
-- sont exigés serveur. Preuve enregistrée sur le corps live (2026-09-06,
-- supabase/tests/counter_combo_server_price.test.sql, sonde en transaction
-- annulée) — combo base 40000, option Large +8000, modificateur Iced +2000 sur
-- le composant Large :
--   * unit_price 40000 (client) et line_total 48000 : l'ajustement du
--     modificateur de composant est perdu — la caisse facture 50000
--     (`lineUnitEach` du domaine), le serveur 48000 ;
--   * `pay_existing_order_v19(cash 50000)` refusé : « Sum of tender amounts
--     (50000.00) != order total (48000.00) » — la vente est impayable au montant
--     affiché au client ;
--   * composant hors de tout groupe accepté sans exception.
--
-- Conception (miroir de create_tablet_order_v9, adaptée au format wire du
-- comptoir) :
--   1. Un combo est pricé serveur par `_resolve_combo_price_v1` (base +
--      surcharges des options + ajustements des modificateurs des composants,
--      ADR-017), comme le money-path (`complete_order_with_payment`) et la
--      tablette. En ligne, un échec de résolution remonte tel quel
--      (check_violation → quarantaine du rejeu, ADR-018 ; P0002 idem).
--   2. Replay dégradé, sous `p_tolerate_unsellable = true` seulement (rejeu
--      hors-ligne et appoint du checkout, ADR-022 déc. 3) : un échec de
--      `_resolve_combo_price_v1` (check_violation ou P0002) est rattrapé et la
--      ligne est facturée CE QUE LA CAISSE A FACTURÉ — unit_price client +
--      surcharges de ligne + ajustements des modificateurs de composants, soit
--      `lineUnitEach` du domaine. C'est la différence avec la tablette, qui ne
--      conserve que `unit_price` : au comptoir, le format wire porte la base dans
--      `unit_price` et les surcharges dans `modifiers[].price_adjustment`, et
--      l'encaissement en file (`payment` / `cash_payment`) porte le montant
--      calculé par le panier. `pay_existing_order` exige l'égalité stricte des
--      règlements et du total : conserver `unit_price` seul aurait fait refuser
--      le règlement rejoué (23514, définitif → quarantaine de l'argent encaissé).
--      L'événement laisse une trace `audit_logs` `order.combo_price_tolerated`
--      (client_unit_price, tolerated_unit_price, sqlstate, reason).
--   3. Miroir de `_resolve_line_price_v2(p_combo := true)` : les modificateurs
--      de LIGNE d'un combo gardent leurs libellés (trace cuisine / historique)
--      mais `price_adjustment` est forcé à 0 et `modifiers_per_unit` à 0 — les
--      surcharges sont déjà dans le prix résolu, jamais comptées deux fois.
--   4. Les lignes NON combo gardent le prix client, comme aujourd'hui (le
--      pricing serveur des lignes simples n'est pas dans ce lot).
--   5. Le rattrapage n'a lieu qu'APRÈS la garde de vendabilité (inchangée) :
--      un composant invendable est refusé avant tout pricing, comme en v7.
--
-- Changements par rapport au corps live de v7 — dans la boucle
-- `FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)`, et rien d'autre :
--   a. DECLARE : `v_product_type TEXT`, `v_comp_mod_adj DECIMAL(12,2)` ;
--   b. le contrôle d'existence lit `p.product_type` (TEXT NOT NULL sous CHECK
--      finished|combo) au lieu d'un EXISTS ;
--   c. après la garde de vendabilité : branche prix combo (résolution serveur +
--      rattrapage tolérant + modificateurs de ligne neutralisés) / sinon le
--      calcul existant de `v_modifiers_per_unit` ;
--   d. `'rpc_version', 'fire_v7'` → `'fire_v8'` dans les trois audits.
-- L'INSERT, la remise de ligne (clamp au brut), la numérotation, l'idempotence
-- et les gardes sont verbatim.
--
-- Versioning monotone : v8 créée, v7 droppée dans cette migration, signature
-- et DEFAULT inchangés. Appelants : `useFireToStations`, `useCheckout` (appoint),
-- `offlineReplay` (POS) — repointés dans la passe client qui suit. Aucun format
-- d'intent d'outbox ne change (ADR-015).
--
-- PROVENANCE DU CORPS : `pg_get_functiondef` sur la base live, relevé le
-- 2026-09-06 (md5 sans espaces 912b4e47f3c7b83c419b8f0c8154545f). Le garde
-- ci-dessous refuse la migration si le corps a dérivé depuis — retransformer
-- depuis le live, ne jamais forcer.
--
-- Grants : miroir exact des grants live (authenticated + service_role) +
-- REVOKE PUBLIC/anon. Types à régénérer (packages/supabase/src/types.generated.ts).

DO $$
DECLARE v_md5 TEXT;
BEGIN
  SELECT md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fire_counter_order_v7';
  IF v_md5 IS DISTINCT FROM '912b4e47f3c7b83c419b8f0c8154545f' THEN
    RAISE EXCEPTION 'corps live de fire_counter_order_v7 inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-06, retransformer depuis pg_get_functiondef', v_md5;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fire_counter_order_v8(p_client_uuid uuid, p_session_id uuid, p_items jsonb, p_order_id uuid DEFAULT NULL::uuid, p_table_number text DEFAULT NULL::text, p_order_type order_type DEFAULT 'take_out'::order_type, p_discount_authorized_by uuid DEFAULT NULL::uuid, p_tolerate_unsellable boolean DEFAULT false, p_source_code text DEFAULT 'P'::text)
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

  SELECT order_id INTO v_existing_order_id
    FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF v_existing_order_id IS NOT NULL THEN
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item;
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
                    jsonb_build_object('rpc_version', 'fire_v8',
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
      SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
        INTO v_modifiers_per_unit FROM jsonb_array_elements(v_modifiers) m;
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
                                 'rpc_version', 'fire_v8'));
  END IF;

  -- ADR-022 dec. 3 : la tolerance est un evenement, jamais un defaut. Elle se
  -- relit dans audit_logs, comme le p_offline_replay de pay_existing_order.
  IF p_tolerate_unsellable THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.sellability_tolerated', 'orders', v_order_id,
              jsonb_build_object('rpc_version', 'fire_v8',
                                 'tolerate_unsellable', true,
                                 'items_count', jsonb_array_length(p_items),
                                 'client_uuid', p_client_uuid));
  END IF;

  IF p_discount_authorized_by IS NOT NULL THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.discount_applied', 'orders', v_order_id,
              jsonb_build_object('authorized_by', p_discount_authorized_by,
                                 'source', 'fire_counter_append', 'rpc_version', 'fire_v8'));
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

REVOKE ALL ON FUNCTION public.fire_counter_order_v8(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fire_counter_order_v8(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fire_counter_order_v8(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fire_counter_order_v8(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text) TO service_role;

COMMENT ON FUNCTION public.fire_counter_order_v8(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text)
  IS 'Envoi en cuisine comptoir (création / append, idempotent par p_client_uuid). v7 : numérotation par origine (p_source_code P | Tn | BO). v8 (2026-09-06, audit lot 1 P0 n°6, décision 6 du 2026-09-05) : les lignes combo sont pricées serveur (_resolve_combo_price_v1 : base + surcharges + ajustements des modificateurs de composants, ADR-017), comme le money-path et la tablette ; les modificateurs de ligne d''un combo gardent leurs libellés avec price_adjustment 0. Sous p_tolerate_unsellable (rejeu hors-ligne / appoint du checkout) un échec de résolution est rattrapé : la ligne est facturée ce que la caisse a facturé (prix client + surcharges + ajustements de composants) et tracée dans audit_logs (order.combo_price_tolerated). Les lignes non combo gardent le prix client. Remplace fire_counter_order_v7.';

-- Versioning monotone : la v7 tombe dans la même migration.
DROP FUNCTION IF EXISTS public.fire_counter_order_v7(uuid, uuid, jsonb, uuid, text, order_type, uuid, boolean, text);

-- Défense en profondeur : anon hérite EXECUTE via PUBLIC sur toute fonction future.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
