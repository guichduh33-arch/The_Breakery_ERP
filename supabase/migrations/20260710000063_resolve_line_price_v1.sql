-- 20260710000063_resolve_line_price_v1.sql
-- Helper interne money-path : résolution canonique du prix d'une ligne (base + modifiers)
-- depuis les tables source. Ignore price_adjustment client. Appelé par
-- complete_order_with_payment_v15 (et futurs RPC money-path).
--
-- Remplace G1 et G2 de l'audit (findings C8/C9) : le price_adjustment envoyé par
-- le client était sommé tel quel — aucun lookup serveur.
--
-- SECURITY DEFINER : accès aux tables product_modifiers et products sans RLS.
-- STABLE : lecture seule, résultat constant pour les mêmes args dans la transaction.
-- REVOKE complet : PUBLIC + anon + authenticated (helper interne, jamais exposé).

CREATE OR REPLACE FUNCTION public._resolve_line_price_v1(
  p_product_id  uuid,
  p_quantity    numeric,
  p_modifiers   jsonb,       -- [{group_name, option_label, ...}] — price_adjustment client IGNORE
  p_customer_id uuid,        -- pour get_customer_product_price (categorie tarifaire)
  p_is_gift     boolean,     -- true -> unit_price=0 et modifiers_total=0
  p_combo       boolean      -- true -> base = products.combo_base_price
) RETURNS TABLE (
  unit_price          numeric,  -- base serveur (0 si is_gift)
  modifiers_total     numeric,  -- Σ price_adjustment serveur par unite (0 si is_gift)
  line_subtotal       numeric,  -- round_idr((unit_price + modifiers_total) * quantity)
  modifiers_resolved  jsonb     -- modifiers re-enrichis du price_adjustment serveur
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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

  -- 2. Modifiers : lookup serveur par scope, price_adjustment client ignore
  IF p_is_gift THEN
    -- Cadeau : aucun modifier ne facture ; on re-enrichit quand meme pour le snapshot
    FOR v_mod IN
      SELECT * FROM jsonb_array_elements(COALESCE(p_modifiers, '[]'::jsonb))
    LOOP
      v_resolved_mods := v_resolved_mods || jsonb_build_array(
        v_mod || jsonb_build_object('price_adjustment', 0)
      );
    END LOOP;
    -- v_mod_per_unit reste 0
  ELSE
    -- Recuperer la categorie du produit une seule fois pour le fallback categorie
    SELECT category_id INTO v_cat_id FROM products WHERE id = p_product_id;

    FOR v_mod IN
      SELECT * FROM jsonb_array_elements(COALESCE(p_modifiers, '[]'::jsonb))
    LOOP
      v_price_adj := NULL;

      -- Scope produit (prioritaire, XOR avec categorie)
      SELECT pm.price_adjustment INTO v_price_adj
        FROM product_modifiers pm
        WHERE pm.product_id   = p_product_id
          AND pm.group_name   = v_mod->>'group_name'
          AND pm.option_label = v_mod->>'option_label'
          AND pm.is_active    = true
          AND pm.deleted_at   IS NULL
        LIMIT 1;

      -- Fallback categorie si absent au niveau produit
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

      -- Option inconnue ou inactive -> check_violation
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
$$;

COMMENT ON FUNCTION public._resolve_line_price_v1(uuid, numeric, jsonb, uuid, boolean, boolean) IS
  'Helper interne money-path (S51) : resout le prix canonique d''une ligne (base + modifiers) '
  'depuis les tables source. Ignore price_adjustment client. Scope XOR produit/categorie '
  '(product_modifiers). Appele uniquement par complete_order_with_payment_v15. '
  'Ne pas exposer a authenticated/anon — internal SECURITY DEFINER.';

-- REVOKE complet : cet helper est money-path-interne uniquement.
-- Les 3 lignes sont obligatoires ensemble (anon herite EXECUTE via PUBLIC).
REVOKE EXECUTE ON FUNCTION public._resolve_line_price_v1(uuid, numeric, jsonb, uuid, boolean, boolean)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_line_price_v1(uuid, numeric, jsonb, uuid, boolean, boolean)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public._resolve_line_price_v1(uuid, numeric, jsonb, uuid, boolean, boolean)
  FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
