-- 20260908000002_display_rpcs_v2_audit_logs.sql
--
-- Finding F4 de docs/audits/2026-08-31-audit-stock-management.md (P1, dimension D).
--
-- Défaut corrigé : les quatre RPC de vitrine n'écrivaient AUCUNE ligne `audit_logs`.
-- Relevé du 2026-08-31 : 16 lignes dans `display_movements`, 0 ligne d'audit `display%`.
-- `display_movements` trace le QUOI ; `audit_logs` trace le QUI, et c'est lui que lit
-- l'écran de sécurité.
--
-- Le cas grave est la perte. `waste_display_stock_v1` court-circuite la primitive
-- `record_stock_movement_v1` et fait un INSERT direct dans `stock_movements`
-- (movement_type='waste', reference_type='display_waste'). C'était donc le SEUL waste du
-- système sans ligne `stock.movement` dans `audit_logs` — tous les autres passent par la
-- primitive, qui écrit l'audit. Or la perte est le vecteur de démarque classique, et
-- `display.manage` est une permission de caisse.
--
-- Geste retenu : l'audit recommandait « soit router la perte par la primitive, soit y
-- ajouter l'INSERT INTO audit_logs canonique ». On prend la seconde branche.
--   · La primitive fige `reference_type = 'admin_action'` : y router la perte perdrait
--     le marqueur `display_waste`, seul lien entre la ligne de ledger et la vitrine.
--   · La primitive refuse aussi un stock global négatif (`insufficient_stock`) alors que
--     le chemin actuel décrémente sans garde : router changerait le comportement de la
--     caisse en plein service, ce que ce lot ne veut pas faire.
-- RÉSIDU ASSUMÉ : l'INSERT direct dans le ledger subsiste. Il se referme avec le
-- finding F2, qui donne à la primitive des arguments `p_reference_type` /
-- `p_reference_id` — la perte de vitrine pourra alors y passer sans rien perdre.
--
-- `actor_id` reçoit le PROFIL (`user_profiles.id`), jamais `auth.uid()` : la FK cible
-- user_profiles(id) et tout compte créé par le back-office a id <> auth_user_id.
-- Les quatre corps résolvaient déjà `v_profile_id`, il est simplement réutilisé.
--
-- `entity_type` au SINGULIER (`display_movement`), conformément à l'arbitrage du
-- 2026-09-06 sur la valeur canonique. Aucune ligne d'audit `display%` n'existe
-- aujourd'hui : il n'y a pas d'historique à reprendre.
--
-- Pas de ligne d'audit sur le chemin de rejeu idempotent : un replay n'est pas un acte
-- neuf. Même doctrine que la primitive, qui retourne avant d'auditer.
--
-- Versioning monotone : _v2 créées, _v1 droppées dans ce fichier, signatures inchangées.
-- PROVENANCE DES CORPS : pg_get_functiondef sur la base live, relevé le 2026-09-07.
-- Grants : miroir des grants live (authenticated + service_role) + REVOKE PUBLIC/anon.
-- Types à régénérer (packages/supabase/src/types.generated.ts).
--
-- NOTE D'APPLICATION (2026-09-07) : ce fichier dépasse la taille que `apply_migration`
-- accepte en un seul appel MCP. Il a donc été appliqué sur dev en TROIS appels — add +
-- adjust, puis return + waste, puis grants et DROP — dans cet ordre. L'état final de la
-- base est identique à ce fichier, qui reste l'artefact de référence ; un rejeu depuis
-- les fichiers produit le même schéma en une passe.

-- ===========================================================================
-- 1. add_display_stock_v2 — mise en vitrine
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.add_display_stock_v2(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile_id        UUID;
  v_is_display        BOOLEAN;
  v_existing_movement UUID;
  v_movement_id       UUID;
  v_new_qty           NUMERIC(10,3);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden: display.manage required' USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  SELECT is_display_item INTO v_is_display
    FROM products
   WHERE id = p_product_id;
  IF v_is_display IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_is_display = FALSE THEN
    RAISE EXCEPTION 'not_a_display_item' USING ERRCODE = 'P0002';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_movement
      FROM display_movements
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF v_existing_movement IS NOT NULL THEN
      SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
      RETURN jsonb_build_object(
        'product_id',         p_product_id,
        'new_display_stock',  COALESCE(v_new_qty, 0),
        'idempotent_replay',  TRUE
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, created_by, idempotency_key
    ) VALUES (
      p_product_id, 'stock_in', p_quantity, p_reason, v_profile_id, p_idempotency_key
    ) RETURNING id INTO v_movement_id;

    INSERT INTO display_stock (product_id, quantity, updated_at)
    VALUES (p_product_id, p_quantity, now())
    ON CONFLICT (product_id) DO UPDATE
      SET quantity   = display_stock.quantity + EXCLUDED.quantity,
          updated_at = now()
    RETURNING quantity INTO v_new_qty;

    -- v2 (F4) : audit_logs trace le QUI ; display_movements traçait déjà le QUOI.
    INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
    VALUES (
      'display.add', 'display_movement', v_movement_id,
      jsonb_build_object(
        'product_id',        p_product_id,
        'quantity',          p_quantity,
        'reason',            p_reason,
        'new_display_stock', v_new_qty,
        'idempotency_key',   p_idempotency_key
      ),
      v_profile_id
    );

    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_new_qty,
      'idempotent_replay',  FALSE
    );

  EXCEPTION WHEN unique_violation THEN
    SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  COALESCE(v_new_qty, 0),
      'idempotent_replay',  TRUE
    );
  END;
END;
$function$;

-- ===========================================================================
-- 2. adjust_display_stock_v2 — recomptage de la vitrine
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.adjust_display_stock_v2(
  p_product_id uuid,
  p_new_qty numeric,
  p_reason text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile_id        UUID;
  v_is_display        BOOLEAN;
  v_existing_movement UUID;
  v_movement_id       UUID;
  v_current_qty       NUMERIC(10,3);
  v_delta             NUMERIC(10,3);
  v_new_qty           NUMERIC(10,3);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden: display.manage required' USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_qty IS NULL OR p_new_qty < 0 THEN
    RAISE EXCEPTION 'quantity_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR length(TRIM(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT is_display_item INTO v_is_display
    FROM products
   WHERE id = p_product_id;
  IF v_is_display IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_is_display = FALSE THEN
    RAISE EXCEPTION 'not_a_display_item' USING ERRCODE = 'P0002';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_movement
      FROM display_movements
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF v_existing_movement IS NOT NULL THEN
      SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
      RETURN jsonb_build_object(
        'product_id',         p_product_id,
        'new_display_stock',  COALESCE(v_new_qty, 0),
        'idempotent_replay',  TRUE,
        'noop',               FALSE
      );
    END IF;
  END IF;

  SELECT quantity INTO v_current_qty
    FROM display_stock
   WHERE product_id = p_product_id
   FOR UPDATE;
  v_current_qty := COALESCE(v_current_qty, 0);
  v_delta := p_new_qty - v_current_qty;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_current_qty,
      'idempotent_replay',  FALSE,
      'noop',               TRUE
    );
  END IF;

  BEGIN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, created_by, idempotency_key
    ) VALUES (
      p_product_id, 'adjustment', v_delta, p_reason, v_profile_id, p_idempotency_key
    ) RETURNING id INTO v_movement_id;

    INSERT INTO display_stock (product_id, quantity, updated_at)
    VALUES (p_product_id, p_new_qty, now())
    ON CONFLICT (product_id) DO UPDATE
      SET quantity   = EXCLUDED.quantity,
          updated_at = now()
    RETURNING quantity INTO v_new_qty;

    -- v2 (F4) : un recomptage de vitrine est un écart déclaré — il doit nommer son auteur.
    INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
    VALUES (
      'display.adjust', 'display_movement', v_movement_id,
      jsonb_build_object(
        'product_id',        p_product_id,
        'previous_qty',      v_current_qty,
        'new_qty',           p_new_qty,
        'delta',             v_delta,
        'reason',            p_reason,
        'new_display_stock', v_new_qty,
        'idempotency_key',   p_idempotency_key
      ),
      v_profile_id
    );

    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_new_qty,
      'idempotent_replay',  FALSE,
      'noop',               FALSE
    );

  EXCEPTION WHEN unique_violation THEN
    SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  COALESCE(v_new_qty, 0),
      'idempotent_replay',  TRUE,
      'noop',               FALSE
    );
  END;
END;
$function$;

-- ===========================================================================
-- 3. return_display_to_kitchen_v2 — retour en cuisine
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.return_display_to_kitchen_v2(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile_id        UUID;
  v_existing_movement UUID;
  v_movement_id       UUID;
  v_current_qty       NUMERIC(10,3);
  v_new_qty           NUMERIC(10,3);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden: display.manage required' USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_movement
      FROM display_movements
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF v_existing_movement IS NOT NULL THEN
      SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
      RETURN jsonb_build_object(
        'product_id',         p_product_id,
        'new_display_stock',  COALESCE(v_new_qty, 0),
        'idempotent_replay',  TRUE
      );
    END IF;
  END IF;

  SELECT quantity INTO v_current_qty
    FROM display_stock
   WHERE product_id = p_product_id
   FOR UPDATE;
  IF v_current_qty IS NULL OR v_current_qty < p_quantity THEN
    RAISE EXCEPTION 'insufficient_display_stock' USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, created_by, idempotency_key
    ) VALUES (
      p_product_id, 'return_to_kitchen', -p_quantity, p_reason, v_profile_id, p_idempotency_key
    ) RETURNING id INTO v_movement_id;

    UPDATE display_stock
       SET quantity = quantity - p_quantity,
           updated_at = now()
     WHERE product_id = p_product_id
    RETURNING quantity INTO v_new_qty;

    -- v2 (F4) : sortie de vitrine sans contrepartie de vente — elle doit nommer son auteur.
    INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
    VALUES (
      'display.return_to_kitchen', 'display_movement', v_movement_id,
      jsonb_build_object(
        'product_id',        p_product_id,
        'quantity',          p_quantity,
        'reason',            p_reason,
        'new_display_stock', v_new_qty,
        'idempotency_key',   p_idempotency_key
      ),
      v_profile_id
    );

    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_new_qty,
      'idempotent_replay',  FALSE
    );

  EXCEPTION WHEN unique_violation THEN
    SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  COALESCE(v_new_qty, 0),
      'idempotent_replay',  TRUE
    );
  END;
END;
$function$;

-- ===========================================================================
-- 4. waste_display_stock_v2 — perte en vitrine (le cas grave de F4)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.waste_display_stock_v2(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile_id        UUID;
  v_is_display        BOOLEAN;
  v_unit              TEXT;
  v_existing_movement UUID;
  v_movement_id       UUID;
  v_ledger_id         UUID;
  v_current_qty       NUMERIC(10,3);
  v_new_display_qty   NUMERIC(10,3);
  v_new_bo_stock      NUMERIC(10,3);
  v_reason            TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden: display.manage required' USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_movement
      FROM display_movements
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF v_existing_movement IS NOT NULL THEN
      SELECT quantity INTO v_new_display_qty FROM display_stock WHERE product_id = p_product_id;
      SELECT current_stock INTO v_new_bo_stock FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'product_id',         p_product_id,
        'new_display_stock',  COALESCE(v_new_display_qty, 0),
        'new_bo_stock',       COALESCE(v_new_bo_stock, 0),
        'idempotent_replay',  TRUE
      );
    END IF;
  END IF;

  SELECT is_display_item, COALESCE(unit, 'pcs')
    INTO v_is_display, v_unit
    FROM products
   WHERE id = p_product_id;
  IF v_is_display IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_is_display = FALSE THEN
    RAISE EXCEPTION 'not_a_display_item' USING ERRCODE = 'P0002';
  END IF;

  SELECT quantity INTO v_current_qty
    FROM display_stock
   WHERE product_id = p_product_id
   FOR UPDATE;
  IF v_current_qty IS NULL OR v_current_qty < p_quantity THEN
    RAISE EXCEPTION 'insufficient_display_stock' USING ERRCODE = 'P0002';
  END IF;

  v_reason := COALESCE(NULLIF(TRIM(p_reason), ''), 'Display waste');
  IF length(v_reason) < 3 THEN
    v_reason := 'Display waste';
  END IF;

  BEGIN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, created_by, idempotency_key
    ) VALUES (
      p_product_id, 'waste', -p_quantity, v_reason, v_profile_id, p_idempotency_key
    ) RETURNING id INTO v_movement_id;

    UPDATE display_stock
       SET quantity = quantity - p_quantity,
           updated_at = now()
     WHERE product_id = p_product_id
    RETURNING quantity INTO v_new_display_qty;

    -- RÉSIDU F2 : INSERT direct dans le ledger, hors primitive, pour conserver
    -- reference_type='display_waste'. Se referme quand la primitive acceptera
    -- p_reference_type / p_reference_id.
    INSERT INTO stock_movements (
      product_id, movement_type, quantity, unit, reason, reference_type, created_by
    ) VALUES (
      p_product_id, 'waste', -p_quantity, v_unit, v_reason, 'display_waste', v_profile_id
    ) RETURNING id INTO v_ledger_id;

    UPDATE products
       SET current_stock = current_stock - p_quantity
     WHERE id = p_product_id
    RETURNING current_stock INTO v_new_bo_stock;

    -- v2 (F4), ligne n°1 : la ligne de ledger reçoit l'audit `stock.movement` que la
    -- primitive aurait écrit. C'était le seul waste du système qui n'en avait pas.
    INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
    VALUES (
      'stock.movement', 'stock_movements', v_ledger_id,
      jsonb_build_object(
        'movement_type',     'waste',
        'quantity',          -p_quantity,
        'unit',              v_unit,
        'reason',            v_reason,
        'new_current_stock', v_new_bo_stock,
        'idempotency_key',   p_idempotency_key,
        'metadata',          jsonb_build_object(
                               'source',              'display_waste',
                               'display_movement_id', v_movement_id
                             ),
        'lot_id',            NULL,
        'allow_negative',    TRUE
      ),
      v_profile_id
    );

    -- v2 (F4), ligne n°2 : le geste de vitrine lui-même.
    INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
    VALUES (
      'display.waste', 'display_movement', v_movement_id,
      jsonb_build_object(
        'product_id',        p_product_id,
        'quantity',          p_quantity,
        'unit',              v_unit,
        'reason',            v_reason,
        'new_display_stock', v_new_display_qty,
        'new_bo_stock',      v_new_bo_stock,
        'stock_movement_id', v_ledger_id,
        'idempotency_key',   p_idempotency_key
      ),
      v_profile_id
    );

    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_new_display_qty,
      'new_bo_stock',       v_new_bo_stock,
      'idempotent_replay',  FALSE
    );

  EXCEPTION WHEN unique_violation THEN
    SELECT quantity INTO v_new_display_qty FROM display_stock WHERE product_id = p_product_id;
    SELECT current_stock INTO v_new_bo_stock FROM products WHERE id = p_product_id;
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  COALESCE(v_new_display_qty, 0),
      'new_bo_stock',       COALESCE(v_new_bo_stock, 0),
      'idempotent_replay',  TRUE
    );
  END;
END;
$function$;

-- ===========================================================================
-- Grants — miroir des grants live des _v1 (authenticated + service_role).
-- REVOKE FROM anon seul est insuffisant : anon hérite EXECUTE via PUBLIC.
-- ===========================================================================

REVOKE EXECUTE ON FUNCTION public.add_display_stock_v2(uuid,numeric,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_display_stock_v2(uuid,numeric,text,uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.add_display_stock_v2(uuid,numeric,text,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.adjust_display_stock_v2(uuid,numeric,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_display_stock_v2(uuid,numeric,text,uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.adjust_display_stock_v2(uuid,numeric,text,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.return_display_to_kitchen_v2(uuid,numeric,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_display_to_kitchen_v2(uuid,numeric,text,uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.return_display_to_kitchen_v2(uuid,numeric,text,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.waste_display_stock_v2(uuid,numeric,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.waste_display_stock_v2(uuid,numeric,text,uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.waste_display_stock_v2(uuid,numeric,text,uuid) TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.waste_display_stock_v2(uuid,numeric,text,uuid) IS
  'Perte en vitrine. Écrit DEUX lignes audit_logs (F4, 2026-09-07) : stock.movement pour '
  'la ligne de ledger, display.waste pour le geste. actor_id = user_profiles.id. '
  'Résidu assumé : INSERT direct dans stock_movements pour conserver '
  'reference_type=display_waste — se referme avec F2 (arguments de référence sur la primitive).';

-- ===========================================================================
-- DROP des _v1 — versioning monotone, même migration.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.add_display_stock_v1(uuid,numeric,text,uuid);
DROP FUNCTION IF EXISTS public.adjust_display_stock_v1(uuid,numeric,text,uuid);
DROP FUNCTION IF EXISTS public.return_display_to_kitchen_v1(uuid,numeric,text,uuid);
DROP FUNCTION IF EXISTS public.waste_display_stock_v1(uuid,numeric,text,uuid);
