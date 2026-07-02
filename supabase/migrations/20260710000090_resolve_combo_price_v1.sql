-- 20260710000090_resolve_combo_price_v1.sql
-- S57 P2.1 (Chantier A, A-D2) — internal helper: validate a combo's chosen
-- components against its combo_groups/combo_group_options AND price it in
-- the same pass (base + Σ surcharge of the selected options). Mirrors the
-- pattern of _resolve_line_price_v1 (_063): SECURITY DEFINER STABLE, full
-- REVOKE (PUBLIC + anon + authenticated) — internal money-path helper only.
--
-- Input shape (p_components): the wire format persisted by the POS cart
-- (see apps/pos/src/stores/cartStore.ts `addCombo`, order_items.combo_components) —
-- [{"product_id": "...", "quantity": 1}, ...]. One element == one selected
-- option (quantity is the per-order-line multiplier used elsewhere for stock
-- deduction, not a per-option repeat count — group cardinality is counted by
-- element, matching packages/domain/src/combos/validateSelection.ts semantics).
--
-- Known limitation (documented, not enforced): the wire payload carries no
-- group_id, only product_id. If the same product_id were configured as an
-- option in two different groups of the same combo (schema allows it — no
-- cross-group uniqueness constraint), a single selected component would count
-- toward BOTH groups' cardinality. This is not expected in practice (each
-- group models a distinct choice category, e.g. drink vs. pastry) and is not
-- exploitable for pricing (surcharge is still summed correctly per component
-- actually selected) — only group min/max bookkeeping could be double-counted.
-- Flagged for a future schema constraint if it ever becomes a real scenario.
--
-- Violations:
--   combo_invalid_component — a component's product_id is not one of the
--     combo's combo_group_options.
--   combo_group_violation   — a group's selected count is outside
--     [min_select, max_select] (is_required is already implied by min_select
--     via the combo_groups CHECK constraint, no separate check needed).

CREATE OR REPLACE FUNCTION public._resolve_combo_price_v1(
  p_combo_product_id uuid,
  p_components        jsonb   -- [{product_id, quantity}, ...] — see note above
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_base           NUMERIC(12,2);
  v_comp           JSONB;
  v_comp_product_id UUID;
  v_surcharge      NUMERIC(12,2);
  v_total          NUMERIC(12,2);
  v_selected_ids   UUID[] := '{}';
  v_group          RECORD;
  v_count          INT;
BEGIN
  SELECT combo_base_price INTO v_base
    FROM products
    WHERE id = p_combo_product_id AND product_type = 'combo' AND deleted_at IS NULL;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Combo not found: %', p_combo_product_id USING ERRCODE = 'P0002';
  END IF;
  v_total := COALESCE(v_base, 0);

  FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(p_components, '[]'::jsonb)) LOOP
    v_comp_product_id := NULLIF(v_comp->>'product_id', '')::UUID;

    SELECT cgo.surcharge INTO v_surcharge
      FROM combo_group_options cgo
      JOIN combo_groups cg ON cg.id = cgo.group_id
      WHERE cg.combo_product_id = p_combo_product_id
        AND cgo.component_product_id = v_comp_product_id
      LIMIT 1;

    IF v_surcharge IS NULL THEN
      RAISE EXCEPTION 'combo_invalid_component: product % is not a valid option for combo %',
        v_comp_product_id, p_combo_product_id USING ERRCODE = 'check_violation';
    END IF;

    v_total := v_total + v_surcharge;
    v_selected_ids := v_selected_ids || v_comp_product_id;
  END LOOP;

  FOR v_group IN
    SELECT id, name, min_select, max_select
      FROM combo_groups
      WHERE combo_product_id = p_combo_product_id
  LOOP
    SELECT count(*) INTO v_count
      FROM unnest(v_selected_ids) AS sel(product_id)
      WHERE EXISTS (
        SELECT 1 FROM combo_group_options cgo
        WHERE cgo.group_id = v_group.id AND cgo.component_product_id = sel.product_id
      );

    IF v_count < v_group.min_select THEN
      RAISE EXCEPTION 'combo_group_violation: group "%" requires at least % option(s), got %',
        v_group.name, v_group.min_select, v_count USING ERRCODE = 'check_violation';
    END IF;
    IF v_count > v_group.max_select THEN
      RAISE EXCEPTION 'combo_group_violation: group "%" allows at most % option(s), got %',
        v_group.name, v_group.max_select, v_count USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) IS
  'Helper interne money-path (S57 A-D2) : valide la composition d''un combo '
  '(appartenance combo_group_options + cardinalite min/max par combo_groups) ET '
  'retourne combo_base_price + Sigma surcharge des composants selectionnes en un '
  'seul passage. Appele par complete_order_with_payment_v17. Ne pas exposer a '
  'authenticated/anon — internal SECURITY DEFINER.';

-- REVOKE complet : cet helper est money-path-interne uniquement.
-- Les 3 lignes sont obligatoires ensemble (anon herite EXECUTE via PUBLIC).
REVOKE EXECUTE ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
