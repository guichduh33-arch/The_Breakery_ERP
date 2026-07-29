-- 20260730000001_fix_resolve_line_price_skip_modifier_lookup_on_combo.sql
--
-- Corrige un blocage money-path : AUCUN combo configuré ne pouvait être encaissé.
--
-- Symptôme : complete_order_with_payment_v21 échouait en 23514
--   « Unknown or inactive modifier option: drink / Capuccino »
-- dès que le POS envoyait un combo dont une option avait été choisie.
--
-- Cause : les options d'un combo voyagent dans `modifiers` (c'est ce qui garde
-- deux combos configurés différemment sur deux lignes de panier distinctes),
-- mais ce ne sont PAS des lignes `product_modifiers` : `group_name` est un
-- groupe de combo (« drink ») et `option_label` un nom de composant
-- (« Capuccino »). Or l'étape 2 de _resolve_line_price_v1 résolvait CHAQUE
-- modifier reçu contre product_modifiers pour le produit de la ligne — le
-- combo — et levait check_violation quand elle ne trouvait pas. L'exemption
-- `p_combo` ne couvrait que l'étape 1 (prix de base).
--
-- Correctif : le lookup est sauté quand `p_combo` est vrai, exactement comme
-- pour un gift. Les libellés choisis sont conservés dans `modifiers_resolved`
-- (le ticket cuisine et l'historique gardent « drink / Capuccino ») et leur
-- price_adjustment est forcé à 0 : sur une ligne combo, le prix est établi par
-- _resolve_combo_price_v1 (combo_base_price + Σ surcharge des options), que
-- complete_order_with_payment_v21 applique juste après. Compter aussi les
-- modifiers doublerait les surcharges.
--
-- Versioning : `_resolve_line_price_v1` est un helper INTERNE — EXECUTE n'est
-- ouvert qu'à postgres et service_role, ni anon ni authenticated, et aucun
-- appel n'existe côté front (seuls des tests pgTAP et d'autres fonctions SQL
-- l'invoquent). La signature est inchangée : pas de _v2, donc aucune des trois
-- fonctions appelantes (complete_order_with_payment_v21, add_order_item_v3,
-- update_order_item_qty_v4) n'a à être bumpée. Décision validée par le
-- propriétaire, 2026-07-30.
--
-- Types : comportement seul, aucune signature ni colonne touchée. [types-noop]

CREATE OR REPLACE FUNCTION public._resolve_line_price_v1(
  p_product_id  uuid,
  p_quantity    numeric,
  p_modifiers   jsonb,
  p_customer_id uuid,
  p_is_gift     boolean,
  p_combo       boolean
)
RETURNS TABLE(unit_price numeric, modifiers_total numeric, line_subtotal numeric, modifiers_resolved jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_unit_price         DECIMAL(14,2) := 0;
  v_mod_per_unit       DECIMAL(14,2) := 0;
  v_price_adj          DECIMAL(12,2);
  v_resolved_mods      JSONB := '[]'::jsonb;
  v_mod                JSONB;
  v_cat_id             UUID;
BEGIN
  -- 1. Prix de base (serveur uniquement, client ignore)
  IF p_is_gift THEN
    v_unit_price := 0;
  ELSIF p_combo THEN
    SELECT COALESCE(combo_base_price, retail_price)
      INTO v_unit_price
      FROM products
      WHERE id = p_product_id;
  ELSE
    v_unit_price := get_customer_product_price(p_product_id, p_customer_id);
  END IF;

  -- 2. Modifiers : lookup serveur par scope, price_adjustment client ignore.
  --    Deux cas sautent le lookup, car leur prix ne vient pas des modifiers :
  --      - gift  : la ligne vaut 0 ;
  --      - combo : les entrees sont les options du combo, pas des
  --                product_modifiers ; le prix vient de _resolve_combo_price_v1.
  --    Dans les deux cas on CONSERVE les libelles (trace cuisine / historique)
  --    et on force price_adjustment a 0.
  IF p_is_gift OR p_combo THEN
    FOR v_mod IN
      SELECT * FROM jsonb_array_elements(COALESCE(p_modifiers, '[]'::jsonb))
    LOOP
      v_resolved_mods := v_resolved_mods || jsonb_build_array(
        v_mod || jsonb_build_object('price_adjustment', 0)
      );
    END LOOP;
  ELSE
    SELECT category_id INTO v_cat_id FROM products WHERE id = p_product_id;

    FOR v_mod IN
      SELECT * FROM jsonb_array_elements(COALESCE(p_modifiers, '[]'::jsonb))
    LOOP
      v_price_adj := NULL;

      SELECT pm.price_adjustment INTO v_price_adj
        FROM product_modifiers pm
        WHERE pm.product_id   = p_product_id
          AND pm.group_name   = v_mod->>'group_name'
          AND pm.option_label = v_mod->>'option_label'
          AND pm.is_active    = true
          AND pm.deleted_at   IS NULL
        LIMIT 1;

      IF v_price_adj IS NULL THEN
        SELECT pm.price_adjustment INTO v_price_adj
          FROM product_modifiers pm
          WHERE pm.category_id  = v_cat_id
            AND pm.group_name   = v_mod->>'group_name'
            AND pm.option_label = v_mod->>'option_label'
            AND pm.is_active    = true
            AND pm.deleted_at   IS NULL
          LIMIT 1;
      END IF;

      IF v_price_adj IS NULL THEN
        RAISE EXCEPTION 'Unknown or inactive modifier option: % / %',
          v_mod->>'group_name', v_mod->>'option_label'
          USING ERRCODE = 'check_violation';
      END IF;

      v_mod_per_unit  := v_mod_per_unit + v_price_adj;
      v_resolved_mods := v_resolved_mods || jsonb_build_array(
        v_mod || jsonb_build_object('price_adjustment', v_price_adj)
      );
    END LOOP;
  END IF;

  RETURN QUERY SELECT
    v_unit_price::numeric,
    v_mod_per_unit::numeric,
    round_idr((v_unit_price + v_mod_per_unit) * p_quantity)::numeric,
    v_resolved_mods;
END;
$function$;

-- Defense-in-depth : anon herite EXECUTE via PUBLIC, REVOKE FROM anon seul ne
-- suffit pas. Ce helper ne doit rester appelable que par les fonctions
-- SECURITY DEFINER qui l'invoquent (postgres / service_role) — etat deja en
-- place avant cette migration, reaffirme ici car CREATE OR REPLACE ne le
-- garantit pas si la fonction venait a etre recreee autrement.
REVOKE EXECUTE ON FUNCTION public._resolve_line_price_v1(uuid, numeric, jsonb, uuid, boolean, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_line_price_v1(uuid, numeric, jsonb, uuid, boolean, boolean) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._resolve_line_price_v1(uuid, numeric, jsonb, uuid, boolean, boolean) IS
  'Prix de ligne canonique cote serveur. Sur une ligne combo (p_combo) comme sur un gift, les modifiers gardent leurs libelles mais ne portent aucun price_adjustment : le prix d''un combo vient de _resolve_combo_price_v1.';
