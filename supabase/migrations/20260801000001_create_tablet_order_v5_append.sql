-- Ajout de lignes à une commande de salle déjà envoyée — décision propriétaire
-- du 2026-08-01 (item 🔴 du backlog TABLET_ORDERING, autorisé par l'ADR-010 D1 :
-- « l'ajout de nouveaux items à la commande reste libre (nouveau KOT) »).
--
-- v5 = corps live de create_tablet_order_v4 (pg_get_functiondef, 2026-08-01),
-- avec un `p_order_id` optionnel — MÊME forme que fire_counter_order_v5 côté
-- comptoir, pour qu'il n'existe qu'un seul modèle d'ajout dans le produit.
--
--   p_order_id NULL      → création (comportement v4, inchangé)
--   p_order_id renseigné → ajout sur une commande de SALLE encore ouverte
--
-- Trois points méritent d'être lus :
--
-- 1) `FOR UPDATE` sur la commande visée. Sans lui, une serveuse peut ajouter un
--    dessert pendant que le caissier encaisse : l'ajout validerait un statut
--    'draft' déjà périmé et la ligne atterrirait sur une commande payée — donc
--    servie et jamais facturée. `pay_existing_order` verrouille cette même ligne
--    (SELECT ... FOR UPDATE) : on attend son verdict, puis on relit le statut.
--
-- 2) Statuts appendables : 'pending_payment' (en attente au comptoir) ET 'draft'
--    (reprise par un caissier, pas encore payée). C'est la règle propriétaire :
--    une seule addition tant que ce n'est pas payé.
--
-- 3) Produit introuvable → P0002. La v4 faisait `INSERT ... SELECT ... WHERE
--    p.id = ?` : un produit supprimé n'insérait AUCUNE ligne et ne levait AUCUNE
--    erreur (audit 2026-07-31). Sur un ajout c'est pire encore — la serveuse
--    croit le dessert parti, la cuisine ne voit rien. Le comptoir lève déjà
--    P0002 ; les deux chemins s'alignent.
--
-- Le garde « table obligatoire pour une commande sur place » ne s'applique qu'à
-- la création : en ajout, la table vient de la commande visée.

CREATE OR REPLACE FUNCTION public.create_tablet_order_v5(
  p_client_uuid uuid,
  p_waiter_id uuid,
  p_table_number text,
  p_order_type order_type,
  p_items jsonb,
  p_notes text DEFAULT NULL::text,
  p_order_id uuid DEFAULT NULL::uuid
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

  -- Idempotent replay check FIRST (before permission check, before any writes).
  -- Vaut aussi pour un ajout : la clé pointe la commande touchée, un rejeu la
  -- renvoie sans réinsérer les lignes.
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
    -- ── Création ────────────────────────────────────────────────────────────
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
    -- ── Ajout ───────────────────────────────────────────────────────────────
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

    SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
    IF v_product_name IS NULL THEN
      RAISE EXCEPTION 'Product % not found', v_product_id USING ERRCODE = 'P0002';
    END IF;

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_modifiers_total := round_idr(v_modifiers_per_unit * v_quantity);
    v_line_total      := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);

    -- Spec B-1 Ph2 — résolution multi-station (override produit > catégorie).
    v_dispatch_stations := _resolve_dispatch_stations_v1(v_product_id);
    v_dispatch_station  := v_dispatch_stations[1];  -- legacy single = 1er élément

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

  -- Trace de l'ajout, miroir de `order.fire_appended` côté comptoir. La création
  -- reste tracée par la commande elle-même (waiter_id + sent_to_kitchen_at).
  IF p_order_id IS NOT NULL THEN
    SELECT id INTO v_actor_profile FROM user_profiles WHERE auth_user_id = v_user_id;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_actor_profile, 'order.tablet_appended', 'orders', v_order_id,
              jsonb_build_object('items_added', v_appended_count,
                                 'client_uuid', p_client_uuid,
                                 'source', 'tablet_append'));
  END IF;

  -- Idempotency key insert : if another concurrent call won the race,
  -- the PK constraint raises unique_violation. Catch + re-read to return their winner order_id.
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

DROP FUNCTION IF EXISTS public.create_tablet_order_v4(uuid, uuid, text, order_type, jsonb, text);

REVOKE ALL     ON FUNCTION public.create_tablet_order_v5(uuid, uuid, text, order_type, jsonb, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_tablet_order_v5(uuid, uuid, text, order_type, jsonb, text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_tablet_order_v5(uuid, uuid, text, order_type, jsonb, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.create_tablet_order_v5 IS
  'Commande de salle : cree (p_order_id NULL) ou AJOUTE des lignes a une commande tablette encore ouverte (pending_payment|draft, verrouillee FOR UPDATE). Produit introuvable -> P0002. Idempotent par client_uuid.';
