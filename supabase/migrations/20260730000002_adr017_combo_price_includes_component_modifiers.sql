-- 20260730000002_adr017_combo_price_includes_component_modifiers.sql
--
-- ADR-017 décision 3 — le prix d'un combo devient :
--   combo_base_price + Σ surcharges des options + Σ ajustements des modificateurs
--   de leurs composants,
-- les trois termes résolus SERVEUR. Aucun montant joint par le client n'est retenu.
--
-- Jusqu'ici, choisir « Oat Milk » sur le Capuccino d'un combo ne coûtait rien,
-- alors que le même lait est facturé quand le café est vendu seul.
--
-- Format : chaque élément de `combo_components` peut désormais porter une clé
-- `modifiers` — un tableau de {group_name, option_label}. L'ajout est ADDITIF :
--   * un composant sans cette clé se comporte exactement comme avant ;
--   * les huit fonctions SQL qui lisent `combo_components` n'y lisent que
--     `product_id` et `quantity`, et ignorent la nouvelle clé sans rien casser.
-- C'est ce qui rend ce lot déployable seul, avant que le POS ne l'émette.
--
-- Résolution : chaque ajustement est cherché dans `product_modifiers` du
-- COMPOSANT — d'abord au scope produit, puis au scope catégorie, comme le fait
-- `_resolve_line_price_v1` pour une ligne ordinaire. Jamais contre le produit
-- combo, qui ne porte pas ces options. Un ajustement introuvable ou inactif est
-- un refus (`combo_component_modifier_unknown`), distinct du refus de
-- composition existant (`combo_invalid_component` / `combo_group_violation`) :
-- ADR-017 conséquence 7 demande que le caissier sache quoi corriger.
--
-- CE LOT NE VALIDE PAS ENCORE LES GROUPES REQUIS (ADR-017 décision 2). Le POS
-- n'émet pas encore les choix de modificateurs : refuser ici un groupe requis
-- non renseigné rendrait inencaissable tout combo contenant un Capuccino ou un
-- Americano. Cette validation s'active dans le lot qui livre la saisie au POS.
--
-- Versioning : `_resolve_combo_price_v1` est un helper INTERNE — EXECUTE ouvert
-- aux seuls postgres et service_role, aucun appel front. La signature est
-- inchangée (les modificateurs voyagent dans `p_components`), donc aucune des
-- fonctions appelantes n'a à être bumpée. Même régime que la migration
-- 20260730000001, arbitré par le propriétaire le 2026-07-30. [types-noop]

CREATE OR REPLACE FUNCTION public._resolve_combo_price_v1(
  p_combo_product_id uuid,
  p_components       jsonb
)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_base            NUMERIC(12,2);
  v_comp            JSONB;
  v_comp_product_id UUID;
  v_comp_cat        UUID;
  v_surcharge       NUMERIC(12,2);
  v_total           NUMERIC(12,2);
  v_selected_ids    UUID[] := '{}';
  v_group           RECORD;
  v_count           INT;
  v_mod             JSONB;
  v_mod_adj         NUMERIC(12,2);
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

    -- ADR-017 : ajustements des modificateurs retenus SUR CE COMPOSANT.
    -- Absente, la clé laisse le prix strictement inchangé (rétro-compatibilité).
    IF jsonb_typeof(v_comp->'modifiers') = 'array' THEN
      SELECT category_id INTO v_comp_cat FROM products WHERE id = v_comp_product_id;

      FOR v_mod IN SELECT * FROM jsonb_array_elements(v_comp->'modifiers') LOOP
        v_mod_adj := NULL;

        SELECT pm.price_adjustment INTO v_mod_adj
          FROM product_modifiers pm
          WHERE pm.product_id   = v_comp_product_id
            AND pm.group_name   = v_mod->>'group_name'
            AND pm.option_label = v_mod->>'option_label'
            AND pm.is_active    = true
            AND pm.deleted_at   IS NULL
          LIMIT 1;

        IF v_mod_adj IS NULL THEN
          SELECT pm.price_adjustment INTO v_mod_adj
            FROM product_modifiers pm
            WHERE pm.category_id  = v_comp_cat
              AND pm.group_name   = v_mod->>'group_name'
              AND pm.option_label = v_mod->>'option_label'
              AND pm.is_active    = true
              AND pm.deleted_at   IS NULL
            LIMIT 1;
        END IF;

        IF v_mod_adj IS NULL THEN
          RAISE EXCEPTION 'combo_component_modifier_unknown: % / % is not an active modifier of component %',
            v_mod->>'group_name', v_mod->>'option_label', v_comp_product_id
            USING ERRCODE = 'check_violation';
        END IF;

        v_total := v_total + v_mod_adj;
      END LOOP;
    END IF;
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
$function$;

REVOKE EXECUTE ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) IS
  'ADR-017 — prix serveur d''un combo : base + somme des surcharges d''options + somme des ajustements des modificateurs de leurs composants. Chaque element de p_components peut porter une cle modifiers [{group_name, option_label}] ; son absence laisse le prix inchange.';
