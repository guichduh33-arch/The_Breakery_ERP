-- 20260901000010_create_tablet_order_v9_combo_components.sql
--
-- Audit lot 1 du 2026-08-31, P0 n°6 (docs/audits/2026-08-31-audit-pos-flow.md)
-- — lot D du plan validé le 2026-09-05 (« la tablette configure et persiste
-- ses combos »).
--
-- `create_tablet_order_v8` validait les composants d'un combo (vendabilité,
-- ADR-022) mais son INSERT dans `order_items` n'écrivait ni `combo_components`
-- ni `modifier_ingredients_deducted`, et prenait `unit_price` tel quel du
-- client. Le déstockage d'une commande tablette a lieu au paiement
-- (`pay_existing_order_v19`, boucle `FOR v_item` qui lit exactement ces deux
-- colonnes) : NULL → zéro mouvement de stock sur les composants et sur les
-- ingrédients des modificateurs de composants. Preuve enregistrée sur le
-- corps live (2026-09-05, supabase/tests/tablet_combo_fire_pay.test.sql) :
-- 9/15 — `combo_components` NULL, `unit_price` 40000 au lieu de 48000 (base
-- 40000 + surcharge Large 8000), `modifier_ingredients_deducted` NULL, stocks
-- des composants 100→100 et de l'ingrédient 50→50 après paiement, composant
-- hors groupe accepté sans exception, aucun audit de tolérance.
--
-- Décisions de Mamat (2026-09-05) :
--   1. Les combos sont validés ET pricés serveur : `_resolve_combo_price_v1`
--      (base + surcharges d'options + ajustements des modificateurs des
--      composants, ADR-017), comme le money-path (`complete_order_with_payment`).
--   2. Sous `p_tolerate_unsellable = true` (rejeu hors-ligne uniquement,
--      ADR-022 déc. 3), un échec de `_resolve_combo_price_v1` (check_violation
--      ou P0002) est rattrapé : prix client conservé + trace `audit_logs`
--      `order.combo_price_tolerated`. Jamais en ligne : sans tolérance,
--      l'exception remonte telle quelle (check_violation → quarantaine du
--      rejeu, ADR-018).
--   3. Le pricing serveur des lignes NON combo n'est pas dans ce lot : hors
--      combo, le prix client reste tel quel.
--   4. Miroir de `_resolve_line_price_v2(p_combo := true)` : les modificateurs
--      de LIGNE d'un combo gardent leurs libellés (trace cuisine / historique)
--      mais `price_adjustment` est forcé à 0 et `modifiers_per_unit` à 0 — les
--      surcharges sont déjà dans le prix résolu, on ne les compte pas deux fois.
--
-- Changements par rapport au corps live de v8 — dans la boucle
-- `FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)`, et rien d'autre :
--   a. DECLARE : `v_product_type TEXT` (`products.product_type` est une colonne
--      TEXT sous CHECK finished|combo, pas un enum) ; lecture de `p.product_type`
--      avec `p.name` ;
--   b. après la garde de vendabilité : branche prix combo (résolution serveur
--      + rattrapage tolérant + modificateurs de ligne neutralisés) / sinon le
--      calcul existant de `v_modifiers_per_unit` ;
--   c. INSERT : colonnes `combo_components` et `modifier_ingredients_deducted`
--      ajoutées — miroir exact de `fire_counter_order_v7` ;
--   d. `'rpc_version', 'tablet_v8'` → `'tablet_v9'` dans l'audit de tolérance.
--
-- Versioning monotone : v9 créée, v8 droppée dans cette migration, signature
-- et DEFAULT inchangés. Appelant : `useCreateTabletOrder` (POS) + `offlineReplay`
-- — repointés dans la passe client qui suit.
--
-- PROVENANCE DU CORPS : `pg_get_functiondef` sur la base live, relevé le
-- 2026-09-05 (md5 sans espaces 9c9774853dce05ec28c84f3500eff412). Le garde
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
   WHERE n.nspname = 'public' AND p.proname = 'create_tablet_order_v8';
  IF v_md5 IS DISTINCT FROM '9c9774853dce05ec28c84f3500eff412' THEN
    RAISE EXCEPTION 'corps live de create_tablet_order_v8 inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-05, retransformer depuis pg_get_functiondef', v_md5;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_tablet_order_v9(p_client_uuid uuid, p_waiter_id uuid, p_table_number text, p_order_type order_type, p_items jsonb, p_notes text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid, p_tolerate_unsellable boolean DEFAULT false, p_source_code text DEFAULT 'T1'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      subtotal, tax_amount, total, notes
    ) VALUES (
      v_order_number, p_order_type, 'pending_payment', 'tablet',
      v_waiter_id, p_table_number, now(),
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
                    jsonb_build_object('rpc_version', 'tablet_v9',
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
      SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
        INTO v_modifiers_per_unit
        FROM jsonb_array_elements(v_modifiers) m;
    END IF;

    v_modifiers_total := round_idr(v_modifiers_per_unit * v_quantity);
    v_line_total      := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);

    v_dispatch_stations := _resolve_dispatch_stations_v1(v_product_id);
    v_dispatch_station  := v_dispatch_stations[1];

    -- v9 — combo_components et modifier_ingredients_deducted persistes, miroir
    -- exact de fire_counter_order_v7 : pay_existing_order lit ces deux colonnes
    -- pour destocker composants et ingredients de modificateurs au paiement.
    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station, dispatch_stations,
      combo_components, is_locked, kitchen_status, sent_to_kitchen_at,
      modifier_ingredients_deducted
    ) VALUES (
      v_order_id, v_product_id, v_product_name, v_unit_price, v_quantity, v_line_total,
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
              jsonb_build_object('rpc_version', 'tablet_v9',
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

REVOKE ALL ON FUNCTION public.create_tablet_order_v9(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tablet_order_v9(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_tablet_order_v9(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tablet_order_v9(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text) TO service_role;

COMMENT ON FUNCTION public.create_tablet_order_v9(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text)
  IS 'Envoi tablette. v8 (audit 2026-08-22, lot C) : p_waiter_id doit être le profil de l''appelant — check_violation sinon, pour que le rejeu hors-ligne quarantaine au lieu de bloquer le drain (ADR-018). v9 (2026-09-05, audit lot 1 P0 n°6) : les lignes combo sont pricées serveur (_resolve_combo_price_v1) et persistent combo_components + modifier_ingredients_deducted, comme le fire comptoir ; sous p_tolerate_unsellable un échec de résolution est rattrapé (prix client, audit order.combo_price_tolerated). Remplace create_tablet_order_v8.';

-- Versioning monotone : la v8 tombe dans la même migration.
DROP FUNCTION IF EXISTS public.create_tablet_order_v8(uuid, uuid, text, order_type, jsonb, text, uuid, boolean, text);

-- Défense en profondeur : anon hérite EXECUTE via PUBLIC sur toute fonction future.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
