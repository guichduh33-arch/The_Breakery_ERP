-- 20260505000004_send_items_rpc.sql
-- Session 2 / migration 4 : RPC send_items_to_kitchen
--
-- D10 : refuse l'opération si AU MOINS UN des items demandés est déjà locké.
--       Atomique — soit tout part, soit rien.
-- K3  : send-to-kitchen incrémental — un nouvel appel ne touche que les items
--       passés en argument (les items précédemment lockés restent lockés).

CREATE OR REPLACE FUNCTION send_items_to_kitchen(p_item_ids UUID[])
RETURNS SETOF order_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_locked INTEGER;
BEGIN
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RAISE EXCEPTION 'no items provided' USING ERRCODE = 'P0011';
  END IF;

  -- D10 guard : refuse si l'un des items est déjà locké.
  SELECT COUNT(*) INTO v_already_locked
  FROM order_items
  WHERE id = ANY(p_item_ids) AND is_locked = true;

  IF v_already_locked > 0 THEN
    RAISE EXCEPTION 'already_locked: % item(s) are already sent', v_already_locked
      USING ERRCODE = 'P0010';
  END IF;

  RETURN QUERY
    UPDATE order_items
    SET is_locked          = true,
        sent_to_kitchen_at = now(),
        kitchen_status     = COALESCE(kitchen_status, 'pending')
    WHERE id = ANY(p_item_ids)
    RETURNING *;
END $$;

GRANT EXECUTE ON FUNCTION send_items_to_kitchen(UUID[]) TO authenticated, anon;

COMMENT ON FUNCTION send_items_to_kitchen(UUID[]) IS
  'Verrouille un batch d''order_items pour la cuisine. Erreur P0010 already_locked si un item est déjà envoyé. Erreur P0011 si tableau vide.';
