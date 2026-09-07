-- Audit lot 2, P0-5 — un composant de combo « non suivi à recette » n'était
-- jamais déstocké, et son compteur partait en négatif.
--
-- Dans la branche NON-combo, les deux RPC appliquent la bonne règle :
--     IF is_display_item OR track_inventory THEN _record_sale_stock_v1(...)
--     ELSIF deduct_stock                    THEN descente recette (ADR-016)
-- Dans la branche COMBO, chaque composant partait inconditionnellement dans
-- `_record_sale_stock_v1`, sans lire aucun des deux drapeaux. Or ce helper écrit
-- son `INSERT INTO stock_movements` et son `UPDATE products SET current_stock`
-- HORS de tout `IF` (vérifié sur son corps live).
--
-- Double effet, sur 14 composants réels de la base dev (Latte, Americano,
-- Capuccino, Affogato, Long Black, Tea, Omelette, Egg Benedict, Fresh Juice,
-- Caramel/Vanilla/Hazelnut Latte — tous `track_inventory = false,
-- deduct_stock = true`) :
--   1. la recette n'est JAMAIS résolue — ni grains, ni lait, ni sirop ne sortent
--      du stock, le COGS est sous-évalué et les matières premières sont fantômes ;
--   2. `products.current_stock` du composant est décrémenté malgré
--      `track_inventory = false`, donc il descend en négatif, et une ligne
--      `stock_movements` est posée sur un produit non suivi.
-- Le même café vendu HORS combo consomme correctement sa recette : les deux
-- chemins divergeaient.
--
-- Aucune fixture pgTAP ne pouvait le voir : toutes les fixtures combo
-- (`combo_sale`, `combo_server_pricing`, `combo_fire_pay`, `tablet_combo_fire_pay`,
-- `counter_combo_server_price`) posent `track_inventory = true`.
--
-- MÉTHODE — bump sans recopie. Les deux corps font 42 Ko et 28 Ko ; les recopier
-- dans ce fichier serait le meilleur moyen d'y glisser une divergence muette. On
-- part donc du CORPS LIVE (`pg_get_functiondef`), on applique des substitutions
-- COMPTÉES, et on lève si un motif n'apparaît pas exactement une fois. La règle
-- posée est le miroir littéral de la branche non-combo de chaque fonction.
--
-- Versioning monotone : v27 → v28, v19 → v20, anciennes DROPées ici même.

DO $mig$
DECLARE
  v_src      TEXT;
  v_old_call TEXT;
  v_new_call TEXT;
  v_n        INT;
BEGIN
  -- ======================================================================
  -- complete_order_with_payment_v27 -> v28
  -- ======================================================================
  v_src := pg_get_functiondef('public.complete_order_with_payment_v27'::regproc);

  v_old_call :=
    'PERFORM _record_sale_stock_v1(' || E'\n' ||
    '          p_product_id     := (v_comp->>''product_id'')::UUID,' || E'\n' ||
    '          p_quantity       := v_comp_qty,' || E'\n' ||
    '          p_reference_id   := v_order_id,' || E'\n' ||
    '          p_created_by     := v_profile_id,' || E'\n' ||
    '          p_reason         := ''POS combo sale'',' || E'\n' ||
    '          p_allow_negative := v_allow_negative' || E'\n' ||
    '        );';

  v_new_call :=
    '-- Audit lot 2 P0-5 : miroir de la branche non-combo ci-dessous. Un' || E'\n' ||
    '        -- composant suivi (ou en vitrine) vend son propre stock ; un fini non' || E'\n' ||
    '        -- suivi avec deduct_stock consomme sa RECETTE (descente ADR-016) ;' || E'\n' ||
    '        -- sans deduct_stock, aucune deduction.' || E'\n' ||
    '        SELECT * INTO v_cmp FROM products WHERE id = (v_comp->>''product_id'')::UUID;' || E'\n' ||
    '        IF v_cmp.is_display_item OR COALESCE(v_cmp.track_inventory, true) THEN' || E'\n' ||
    '          PERFORM _record_sale_stock_v1(' || E'\n' ||
    '            p_product_id     := v_cmp.id,' || E'\n' ||
    '            p_quantity       := v_comp_qty,' || E'\n' ||
    '            p_reference_id   := v_order_id,' || E'\n' ||
    '            p_created_by     := v_profile_id,' || E'\n' ||
    '            p_reason         := ''POS combo sale'',' || E'\n' ||
    '            p_unit           := v_cmp.unit,' || E'\n' ||
    '            p_allow_negative := v_allow_negative' || E'\n' ||
    '          );' || E'\n' ||
    '        ELSIF COALESCE(v_cmp.deduct_stock, false) THEN' || E'\n' ||
    '          FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_cmp.id, v_comp_qty) LOOP' || E'\n' ||
    '            PERFORM _record_sale_stock_v1(' || E'\n' ||
    '              p_product_id     := v_cons.product_id,' || E'\n' ||
    '              p_quantity       := v_cons.qty_base,' || E'\n' ||
    '              p_reference_id   := v_order_id,' || E'\n' ||
    '              p_created_by     := v_profile_id,' || E'\n' ||
    '              p_reason         := ''POS combo recipe consumption'',' || E'\n' ||
    '              p_unit           := v_cons.unit,' || E'\n' ||
    '              p_allow_negative := v_allow_negative' || E'\n' ||
    '            );' || E'\n' ||
    '          END LOOP;' || E'\n' ||
    '        END IF;';

  v_n := (length(v_src) - length(replace(v_src, v_old_call, ''))) / length(v_old_call);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'v27: le PERFORM combo attendu apparait % fois (attendu 1) — corps live different de l''audit', v_n;
  END IF;
  v_src := replace(v_src, v_old_call, v_new_call);

  -- Variable de travail pour les drapeaux du composant.
  v_n := (length(v_src) - length(replace(v_src, 'AS $function$' || E'\n' || 'DECLARE', ''))) / length('AS $function$' || E'\n' || 'DECLARE');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'v27: ancre DECLARE trouvee % fois (attendu 1)', v_n;
  END IF;
  v_src := replace(v_src,
    'AS $function$' || E'\n' || 'DECLARE',
    'AS $function$' || E'\n' || 'DECLARE' || E'\n' || '  v_cmp products%ROWTYPE;  -- audit lot 2 P0-5 : drapeaux du composant de combo');

  v_n := (length(v_src) - length(replace(v_src, 'complete_order_with_payment_v27', ''))) / length('complete_order_with_payment_v27');
  IF v_n < 1 THEN
    RAISE EXCEPTION 'v27: nom introuvable dans le corps';
  END IF;
  v_src := replace(v_src, 'complete_order_with_payment_v27', 'complete_order_with_payment_v28');

  EXECUTE v_src;

  -- ======================================================================
  -- pay_existing_order_v19 -> v20
  -- ======================================================================
  v_src := pg_get_functiondef('public.pay_existing_order_v19'::regproc);

  v_old_call :=
    'PERFORM _record_sale_stock_v1(' || E'\n' ||
    '          p_product_id     := (v_comp->>''product_id'')::UUID,' || E'\n' ||
    '          p_quantity       := v_comp_qty,' || E'\n' ||
    '          p_reference_id   := p_order_id,' || E'\n' ||
    '          p_created_by     := v_profile_id,' || E'\n' ||
    '          p_reason         := ''POS combo sale (pay existing)'',' || E'\n' ||
    '          p_allow_negative := v_allow_negative' || E'\n' ||
    '        );';

  v_new_call :=
    '-- Audit lot 2 P0-5 : miroir de la branche non-combo ci-dessous.' || E'\n' ||
    '        SELECT * INTO v_cmp FROM products WHERE id = (v_comp->>''product_id'')::UUID;' || E'\n' ||
    '        IF v_cmp.is_display_item OR COALESCE(v_cmp.track_inventory, true) THEN' || E'\n' ||
    '          PERFORM _record_sale_stock_v1(' || E'\n' ||
    '            p_product_id     := v_cmp.id,' || E'\n' ||
    '            p_quantity       := v_comp_qty,' || E'\n' ||
    '            p_reference_id   := p_order_id,' || E'\n' ||
    '            p_created_by     := v_profile_id,' || E'\n' ||
    '            p_reason         := ''POS combo sale (pay existing)'',' || E'\n' ||
    '            p_unit           := v_cmp.unit,' || E'\n' ||
    '            p_allow_negative := v_allow_negative' || E'\n' ||
    '          );' || E'\n' ||
    '        ELSIF COALESCE(v_cmp.deduct_stock, false) THEN' || E'\n' ||
    '          FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_cmp.id, v_comp_qty) LOOP' || E'\n' ||
    '            PERFORM _record_sale_stock_v1(' || E'\n' ||
    '              p_product_id     := v_cons.product_id,' || E'\n' ||
    '              p_quantity       := v_cons.qty_base,' || E'\n' ||
    '              p_reference_id   := p_order_id,' || E'\n' ||
    '              p_created_by     := v_profile_id,' || E'\n' ||
    '              p_reason         := ''POS combo recipe consumption (pay existing)'',' || E'\n' ||
    '              p_unit           := v_cons.unit,' || E'\n' ||
    '              p_allow_negative := v_allow_negative' || E'\n' ||
    '            );' || E'\n' ||
    '          END LOOP;' || E'\n' ||
    '        END IF;';

  v_n := (length(v_src) - length(replace(v_src, v_old_call, ''))) / length(v_old_call);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'v19: le PERFORM combo attendu apparait % fois (attendu 1)', v_n;
  END IF;
  v_src := replace(v_src, v_old_call, v_new_call);

  v_n := (length(v_src) - length(replace(v_src, 'AS $function$' || E'\n' || 'DECLARE', ''))) / length('AS $function$' || E'\n' || 'DECLARE');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'v19: ancre DECLARE trouvee % fois (attendu 1)', v_n;
  END IF;
  v_src := replace(v_src,
    'AS $function$' || E'\n' || 'DECLARE',
    'AS $function$' || E'\n' || 'DECLARE' || E'\n' || '  v_cmp products%ROWTYPE;  -- audit lot 2 P0-5 : drapeaux du composant de combo');

  v_src := replace(v_src, 'pay_existing_order_v19', 'pay_existing_order_v20');

  EXECUTE v_src;
END $mig$;

-- Grants : une fonction neuve nait ouverte a `authenticated` via les DEFAULT
-- PRIVILEGES du projet. On repose explicitement la meme posture que les v27/v19.
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v28 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v28 FROM anon;
REVOKE EXECUTE ON FUNCTION public.pay_existing_order_v20 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pay_existing_order_v20 FROM anon;

COMMENT ON FUNCTION public.complete_order_with_payment_v28 IS
  'Money-path POS (via EF process-payment). v28 : les composants de combo respectent is_display_item / track_inventory / deduct_stock — un composant a recette consomme enfin sa recette au lieu de decrementer un stock non suivi (audit lot 2 P0-5).';
COMMENT ON FUNCTION public.pay_existing_order_v20 IS
  'Encaissement d''une commande deja tiree. v20 : meme correctif combo que complete_order_with_payment_v28 (audit lot 2 P0-5).';

-- Signatures RELEVÉES sur `pg_proc`, jamais devinées : un `DROP IF EXISTS` à
-- signature fausse est un no-op SILENCIEUX. C'est ainsi que
-- `get_stock_movements_v1` a survécu à son propre DROP en juin, et que le
-- back-office appelle depuis lors une version censée être morte.
DROP FUNCTION IF EXISTS public.complete_order_with_payment_v27(uuid,order_type,jsonb,jsonb,uuid,uuid,integer,text,numeric,text,numeric,text,uuid,jsonb,jsonb,uuid,text);
DROP FUNCTION IF EXISTS public.pay_existing_order_v19(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean);
