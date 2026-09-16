-- 20260908000007_sale_helpers_error_message_family.sql
--
-- Résidu du lot stock (PR #503, finding F4). Correction d'un seul message d'erreur,
-- dans deux helpers.
--
-- `_record_sale_stock_v1` et `_record_cancel_waste_stock_v1` lèvent, quand un article
-- de vitrine n'a pas de ligne `display_stock` :
--
--     'No display_stock row for display product % — run add_display_stock_v1 first'
--
-- `add_display_stock_v1` a été droppée le 2026-09-08 (F4, migration `20260908000002`) :
-- la famille vit désormais en `_v2`. Le message envoie donc le lecteur vers une
-- fonction qui n'existe plus — et il le fait sur le chemin de la VENTE, c'est-à-dire au
-- pire moment : la caisse est bloquée et l'indication est fausse.
--
-- Le message nomme désormais la **famille** (`add_display_stock`), pas la version.
-- C'est la règle de gouvernance du dépôt — « une fiche, une skill, un agent citent la
-- famille, jamais la version » — et c'est ici la seule forme qui reste vraie au
-- prochain bump. C'est aussi ce qui évite que ce correctif ait à être refait.
--
-- Rien d'autre ne change : ni signature, ni garde, ni ordre des écritures, ni ERRCODE.
-- Les deux fonctions sont des helpers INTERNES (préfixe `_`, grants
-- `{postgres=X, service_role=X}` relevés le 2026-09-08, aucun `authenticated`, aucun
-- appel applicatif) : elles se remplacent EN PLACE, même régime que le volet 1 de F2 et
-- que les deux remplacements historiques de `_record_sale_stock_v1` lui-même
-- (`20260710000107`, `20260726000230`).
--
-- Aucun changement de schéma : pas de régénération de types.
--
-- PROVENANCE DES CORPS : pg_get_functiondef sur la base live, relevé le 2026-09-08. La
-- garde ci-dessous refuse la migration si un corps a dérivé depuis ce relevé — le
-- remplacement serait alors une régression silencieuse, puisqu'il réécrirait le corps
-- entier pour changer une chaîne.
--
-- Minimalité PROUVÉE avant application, en transaction annulée : hors commentaires et
-- espaces, le nouveau corps est le hachage EXACT de l'ancien avec la seule chaîne du
-- message substituée, pour les deux fonctions.
--
-- NOTE D'APPLICATION (2026-09-08) : sur dev, ce fichier a été appliqué en deux temps.
-- Le premier jet portait un commentaire qui citait `add_display_stock_v1` — le nom mort
-- réapparaissait donc dans le corps, et tout relevé « qui cite encore une RPC droppée ? »
-- pointait ces deux helpers, c'est-à-dire le correctif lui-même. Le commentaire a été
-- reformulé par une seconde application, programmatique et bornée à cette chaîne. CE
-- FICHIER porte l'état final ; un rejeu depuis les fichiers l'atteint en une passe.

DO $$
DECLARE
  v_expected CONSTANT jsonb := jsonb_build_object(
    '_record_sale_stock_v1',         '22abaa51c843314175d1c9b0041b421e',
    '_record_cancel_waste_stock_v1', '47df7c3cd80ba81d6ddaaaa98c455173'
  );
  v_name TEXT;
  v_md5  TEXT;
BEGIN
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_md5 IS DISTINCT FROM (v_expected ->> v_name) THEN
      RAISE EXCEPTION 'corps live de % inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-08, retransformer depuis pg_get_functiondef', v_name, v_md5;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- _record_sale_stock_v1 — chemin de VENTE (le seul écrivain légitime du ledger
-- hors primitive : celle-ci refuse explicitement 'sale' et 'sale_void').
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._record_sale_stock_v1(
  p_product_id uuid,
  p_quantity numeric,
  p_reference_id uuid,
  p_created_by uuid,
  p_reason text,
  p_movement_type movement_type DEFAULT 'sale'::movement_type,
  p_reference_type text DEFAULT 'orders'::text,
  p_unit text DEFAULT NULL::text,
  p_allow_negative boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_display boolean;
  v_track      boolean;
  v_current    numeric;
  v_unit       text;
  v_name       text;
  v_disp_qty   numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid sale quantity % for product %', p_quantity, p_product_id;
  END IF;

  SELECT is_display_item, COALESCE(track_inventory, true), current_stock, COALESCE(p_unit, unit, 'pcs'), name
    INTO v_is_display, v_track, v_current, v_unit, v_name
    FROM products WHERE id = p_product_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  IF v_is_display THEN
    SELECT quantity INTO v_disp_qty FROM display_stock WHERE product_id = p_product_id;
    -- S61 F-2 : garde inconditionnelle (plus de NOT p_allow_negative) + ERRCODE P0002
    IF COALESCE(v_disp_qty, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient display stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_disp_qty, 0)
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_track THEN
    IF NOT p_allow_negative AND COALESCE(v_current, 0) < p_quantity THEN
      -- S61 F-2 : ERRCODE P0002 (l'EF process-payment mappe P0002 -> insufficient_stock 409)
      RAISE EXCEPTION 'Insufficient stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_current, 0)
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
  ) VALUES (
    p_product_id, p_movement_type, -p_quantity, v_unit, p_reference_type, p_reference_id, p_created_by
  );

  UPDATE products
    SET current_stock = current_stock - p_quantity, updated_at = now()
    WHERE id = p_product_id;

  IF v_is_display THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, p_movement_type::text::display_movement_type, -p_quantity, p_reason, 'order', p_reference_id, p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
    IF NOT FOUND THEN
      -- 2026-09-08 : on cite la FAMILLE, jamais la version — la v1 a été droppée (F4).
      RAISE EXCEPTION 'No display_stock row for display product % — run add_display_stock first', p_product_id;
    END IF;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- _record_cancel_waste_stock_v1 — perte sur annulation de ligne de commande.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._record_cancel_waste_stock_v1(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_order_id uuid,
  p_order_item_id uuid,
  p_created_by uuid,
  p_unit text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_display boolean;
  v_unit       text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid waste quantity % for product %', p_quantity, p_product_id;
  END IF;

  SELECT is_display_item, COALESCE(p_unit, unit, 'pcs')
    INTO v_is_display, v_unit
    FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason,
    reference_type, reference_id, created_by, metadata
  ) VALUES (
    p_product_id, 'waste', -p_quantity, v_unit, p_reason,
    'order_cancel', p_order_id, p_created_by,
    jsonb_build_object('order_item_id', p_order_item_id)
  );

  UPDATE products
    SET current_stock = current_stock - p_quantity, updated_at = now()
    WHERE id = p_product_id;

  IF v_is_display THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, 'waste', -p_quantity, p_reason, 'order_cancel', p_order_id, p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
    IF NOT FOUND THEN
      -- 2026-09-08 : on cite la FAMILLE, jamais la version — la v1 a été droppée (F4).
      RAISE EXCEPTION 'No display_stock row for display product % — run add_display_stock first', p_product_id;
    END IF;
  END IF;
END;
$function$;

-- Grants : miroir exact des grants live relevés le 2026-09-08
-- (`{postgres=X, service_role=X}`). `authenticated` n'y figure pas — helpers internes.
REVOKE EXECUTE ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public._record_cancel_waste_stock_v1(uuid, numeric, text, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._record_cancel_waste_stock_v1(uuid, numeric, text, uuid, uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._record_cancel_waste_stock_v1(uuid, numeric, text, uuid, uuid, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._record_cancel_waste_stock_v1(uuid, numeric, text, uuid, uuid, uuid, text) TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
