-- 20260901000008_reopen_held_order_v2_exclude_cancelled.sql
--
-- Audit lot 1 du 2026-08-31, P0 n°5 (docs/audits/2026-08-31-audit-pos-flow.md)
-- — lot C du plan validé le 2026-09-05 (« lignes annulées exclues par prédicat »).
--
-- `reopen_held_order_v1` renvoyait TOUTES les lignes de la commande, y compris
-- celles annulées par `cancel_order_item_rpc_v6` (ADR-010) : le terminal qui
-- rouvrait une commande mise en attente réhydratait la ligne annulée dans le
-- panier, la ré-affichait et la re-présentait à l'encaissement. Preuve
-- enregistrée sur le corps live (2026-09-05) : fire A + B + C, annulation
-- d'une ligne, reopen → 3 items renvoyés. De plus les items ne portaient ni
-- `product_type` ni `combo_components` : le client ne pouvait pas distinguer
-- un combo d'un produit simple à la réouverture.
--
-- Décisions de Mamat (2026-09-05) :
--   1. Exclusion par PRÉDICAT (`oi.is_cancelled = false`) dans l'agrégat des
--      items — la ligne annulée reste en base, elle n'est plus réhydratée.
--   2. Chaque item renvoie aussi `product_type` (depuis `products`) et
--      `combo_components` (depuis `order_items`). NULL → `null` JSON, c'est
--      voulu : le client lit `?? undefined`.
--   3. Aucun `rpc_version` introduit (aucune dans cette famille) ;
--      `SET search_path TO 'public'` conservé tel que live.
--
-- Changements par rapport au corps live de v1, et rien d'autre :
--   a. `FROM order_items oi WHERE oi.order_id = p_order_id`
--      → `JOIN products p ON p.id = oi.product_id` + `AND oi.is_cancelled = false` ;
--   b. deux clés ajoutées à l'objet item : 'product_type', 'combo_components'.
--
-- Versioning monotone : v2 créée, v1 droppée dans cette migration, signature
-- inchangée. Appelant : `useReopenHeldOrder` (POS) — repointé dans le lot
-- client qui suit.
--
-- PROVENANCE DU CORPS : `pg_get_functiondef` sur la base live, relevé le
-- 2026-09-05 (md5 sans espaces 8b404b5d7bb6362cd8f49ec53aa8045f). Le garde
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
   WHERE n.nspname = 'public' AND p.proname = 'reopen_held_order_v1';
  IF v_md5 IS DISTINCT FROM '8b404b5d7bb6362cd8f49ec53aa8045f' THEN
    RAISE EXCEPTION 'corps live de reopen_held_order_v1 inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-05, retransformer depuis pg_get_functiondef', v_md5;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reopen_held_order_v2(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_order         RECORD;
  v_items         JSONB;
  v_actor_profile UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  UPDATE orders
     SET is_held = false
   WHERE id = p_order_id
     AND is_held = true
     AND status = 'pending_payment'
   RETURNING id, order_number, order_type, customer_id, table_number, notes
     INTO v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found_or_already_open' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id',               oi.id,
           'product_id',       oi.product_id,
           'name',             oi.name_snapshot,
           'unit_price',       oi.unit_price,
           'quantity',         oi.quantity,
           'modifiers',        COALESCE(oi.modifiers, '[]'::jsonb),
           'is_locked',        oi.is_locked,
           'kitchen_status',   oi.kitchen_status,
           'product_type',     p.product_type,
           'combo_components', oi.combo_components
         ) ORDER BY oi.created_at)
    INTO v_items
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id
    AND oi.is_cancelled = false;

  SELECT id INTO v_actor_profile
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.reopened', 'orders', p_order_id, '{}'::jsonb);

  RETURN jsonb_build_object(
    'order_id',    v_order.id,
    'order_number',v_order.order_number,
    'order_type',  v_order.order_type,
    'customerId',  v_order.customer_id,
    'tableNumber', v_order.table_number,
    'notes',       v_order.notes,
    'items',       COALESCE(v_items, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.reopen_held_order_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_held_order_v2(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reopen_held_order_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_held_order_v2(uuid) TO service_role;

COMMENT ON FUNCTION public.reopen_held_order_v2(uuid) IS
  'Reopens a held fired order on a terminal: claims it (is_held=false, status stays pending_payment, a concurrent second reopen gets P0002) and returns the cart payload (items carry order_items.id, is_locked, kitchen_status, product_type, combo_components so the client rehydrates lock/print/combo state). v2 (2026-09-05, audit lot 1 P0 n°5): cancelled lines (is_cancelled) are excluded from the returned items; product_type and combo_components added per item. Gate pos.sale.create. Audit order.reopened. Errors: P0001/P0002/P0003.';

-- Versioning monotone : la v1 tombe dans la même migration.
DROP FUNCTION IF EXISTS public.reopen_held_order_v1(uuid);

-- Défense en profondeur : anon hérite EXECUTE via PUBLIC sur toute fonction future.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
