-- 20260731000001_adr017_d2_require_component_modifier_answers.sql
--
-- ADR-017 décision 2 — ACTIVATION de la validation serveur des groupes requis :
-- un combo dont un composant retenu porte un groupe de modificateurs requis
-- sans réponse est refusé (`combo_component_required_modifier_missing`, code
-- distinct dans le message, ERRCODE check_violation comme les autres refus de
-- composition — conséquence 7 : le caissier sait quoi corriger).
--
-- Ce refus avait été volontairement différé par 20260730000002 tant que le POS
-- n'émettait pas les choix ; l'émission est livrée (branche ADR-017 mergée le
-- 2026-07-31), l'activation devient sûre. Un composant SANS groupe requis
-- continue de passer sans la clé `modifiers` (rétro-compatibilité conservée
-- pour lui seul).
--
-- Sémantique — miroir exact de `mergeGroups` (packages/domain) : les groupes
-- du scope PRODUIT priment ; un groupe du scope CATÉGORIE n'est exigé que si
-- aucun groupe actif du scope produit ne porte le même nom (fallback). Seuls
-- les groupes ACTIFS (is_active, non supprimés) peuvent exiger une réponse.
--
-- Périmètre : `complete_order_with_payment_v22` (encaissement direct via l'EF
-- process-payment) — seul chemin qui appelle `_resolve_combo_price_v1`.
-- `fire_counter_order_v5` ne valide toujours pas la composition côté serveur
-- (lacune préexistante, hors mandat) : le blocage y reste porté par le POS.
--
-- Versioning : `_resolve_combo_price_v1` est un helper INTERNE — EXECUTE ouvert
-- aux seuls postgres et service_role, aucun appel front. Signature inchangée,
-- donc pas de `_v2` et aucune appelante bumpée. Même régime que 20260730000001
-- et 20260730000002, arbitré par le propriétaire le 2026-07-30. [types-noop]
--
-- PROVENANCE DU CORPS : transformé depuis le corps LIVE (pg_get_functiondef,
-- relevé le 2026-07-31). Le garde ci-dessous fait échouer la migration si le
-- corps en base a dérivé depuis ce relevé — dans ce cas, retransformer depuis
-- le live, ne jamais forcer.

DO $$
DECLARE v_md5 TEXT;
BEGIN
  SELECT md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_resolve_combo_price_v1';
  IF v_md5 IS DISTINCT FROM '6237d73bd9f07f9c7f4e79f8ae427403' THEN
    RAISE EXCEPTION 'corps live de _resolve_combo_price_v1 inattendu (md5 %) — il a dérivé depuis le relevé du 2026-07-31, retransformer depuis pg_get_functiondef', v_md5;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._resolve_combo_price_v1(p_combo_product_id uuid, p_components jsonb)
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

    SELECT category_id INTO v_comp_cat FROM products WHERE id = v_comp_product_id;

    -- ADR-017 : ajustements des modificateurs retenus SUR CE COMPOSANT.
    -- Absente, la cle laisse le prix strictement inchange (retro-compatibilite).
    IF jsonb_typeof(v_comp->'modifiers') = 'array' THEN
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

    -- ADR-017 decision 2 (activee le 2026-07-31) : chaque groupe requis du
    -- composant doit porter une reponse. Miroir de mergeGroups : le scope
    -- produit prime, le scope categorie n'est exige que pour les noms de
    -- groupe qu'aucun groupe produit actif ne recouvre.
    FOR v_group IN
      SELECT g.group_name FROM (
        SELECT DISTINCT pm.group_name
          FROM product_modifiers pm
         WHERE pm.product_id     = v_comp_product_id
           AND pm.group_required = true
           AND pm.is_active      = true
           AND pm.deleted_at     IS NULL
        UNION
        SELECT DISTINCT pm.group_name
          FROM product_modifiers pm
         WHERE pm.category_id    = v_comp_cat
           AND pm.product_id     IS NULL
           AND pm.group_required = true
           AND pm.is_active      = true
           AND pm.deleted_at     IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM product_modifiers pp
              WHERE pp.product_id = v_comp_product_id
                AND pp.group_name = pm.group_name
                AND pp.is_active  = true
                AND pp.deleted_at IS NULL)
      ) g
    LOOP
      IF NOT EXISTS (
        SELECT 1
          FROM jsonb_array_elements(COALESCE(v_comp->'modifiers', '[]'::jsonb)) m
         WHERE m->>'group_name' = v_group.group_name
      ) THEN
        RAISE EXCEPTION 'combo_component_required_modifier_missing: group "%" of component % requires an answer',
          v_group.group_name, v_comp_product_id USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
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

-- CREATE OR REPLACE conserve les ACL existantes ; le trio est reaffirme par
-- defense-in-depth (idempotent).
REVOKE EXECUTE ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._resolve_combo_price_v1(uuid, jsonb) IS
  'ADR-017 — prix serveur d''un combo : base + somme des surcharges d''options + somme des ajustements des modificateurs de leurs composants. Chaque element de p_components peut porter une cle modifiers [{group_name, option_label}]. Depuis le 2026-07-31 (decision 2 activee), un groupe requis d''un composant retenu sans reponse est refuse (combo_component_required_modifier_missing).';
