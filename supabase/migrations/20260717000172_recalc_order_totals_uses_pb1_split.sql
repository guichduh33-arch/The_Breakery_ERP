-- 20260717000172_recalc_order_totals_uses_pb1_split.sql
-- Lot 6a (2/8) — `_recalc_order_totals` cesse de porter la formule PB1 et
-- délègue à `_pb1_split_v1` (migration _171).
--
-- Portée réelle de ce seul changement : `_recalc_order_totals` est la voie de
-- recalcul de TOUTE édition de lignes sur une commande ouverte. Le brancher
-- corrige par ricochet, sans les toucher :
--   * add_order_item_v1
--   * remove_order_item_v1
--   * update_order_item_qty_v1
--   * hold_order_v1
--
-- Helper interne, signature inchangée → CREATE OR REPLACE, pas de bump de version
-- (même convention que le fix H2 du 2026-06-01 et la corrective S25 _015).
--
-- À COMPORTEMENT CONSTANT : `business_config.tax_inclusive` vaut `true`, donc
-- `_pb1_split_v1` retourne (x, round_idr(x*r/(1+r)), x) — exactement ce que la
-- formule en dur calculait. Preuve : `supabase/tests/
-- recalc_order_totals_pb1_inclusive.test.sql` doit rester vert SANS modification.
--
-- Corps repris de `pg_get_functiondef` live (vérifié conforme au fichier _161).

CREATE OR REPLACE FUNCTION public._recalc_order_totals(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_items_total NUMERIC := 0;
  v_subtotal    NUMERIC;
  v_tax         NUMERIC;
  v_total       NUMERIC;
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
  FROM order_items WHERE order_id = p_order_id;

  -- Le mode taxe (inclusive/exclusive) vit UNIQUEMENT dans _pb1_split_v1.
  SELECT subtotal, tax_amount, total
    INTO v_subtotal, v_tax, v_total
  FROM _pb1_split_v1(v_items_total);

  UPDATE orders SET
    subtotal   = v_subtotal,
    tax_amount = v_tax,
    total      = v_total,
    updated_at = now()
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public._recalc_order_totals(UUID) FROM authenticated;

COMMENT ON FUNCTION public._recalc_order_totals IS
  'S33 helper — recompute des totaux d''une commande ouverte après édition de '
  'lignes. Lot 6a (2026-07-17) : ne porte plus la formule PB1, délègue à '
  '_pb1_split_v1 (seul porteur du mode inclusive/exclusive). Corrige par ricochet '
  'add/remove/update_order_item_v1 et hold_order_v1. '
  'Interne — REVOKEd de tous les rôles, invoqué uniquement via la chaîne '
  'SECURITY DEFINER.';
