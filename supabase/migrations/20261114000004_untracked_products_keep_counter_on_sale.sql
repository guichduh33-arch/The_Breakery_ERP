-- S1-11 — une vente ne change plus le compteur d'un produit non suivi.
--
-- Décision de Mamat (04_QUESTIONS_CLARIFICATION, S09, lot 4) : rendre la
-- mise à jour de `products.current_stock` conditionnelle à `track_inventory`.
-- Décision du 2026-11-14 : les compteurs déjà dérivés restent tels quels
-- (47 produits non suivis à compteur non nul en production ce jour-là) ;
-- aucun mouvement de correction n'est écrit.
--
-- Trois helpers internes du chemin de vente (grants postgres + service_role
-- seulement, aucun appel applicatif) sont remplacés EN PLACE, même nom et même
-- signature, comme leurs remplacements précédents :
--   - `_record_sale_stock_v1`         : vente (décrément) ;
--   - `_restore_sale_stock_v1`        : annulation et remboursement (incrément),
--     symétrique, sinon un remboursement ferait monter le compteur ;
--   - `_record_cancel_waste_stock_v1` : perte sur commande annulée (décrément).
--
-- Le mouvement de stock reste écrit dans les trois cas : il porte le coût des
-- ventes de la chaîne comptable (S1-05). Seul le compteur ne bouge plus.
--
-- Garde B2B (S11, que la décision S09 disait « sans objet, à vérifier ») :
-- vérifié le 2026-11-14, elle ne l'est pas. La garde de solde du stock
-- général s'appliquait aussi au produit non suivi d'une commande B2B ; son
-- compteur ne bougeant plus, une commande B2B d'un produit non suivi à
-- compteur nul serait refusée pour toujours. Elle est limitée aux produits
-- suivis, comme le dit ADR-036 (« règles de consommation des produits
-- suivis »). Pour un produit suivi, le B2B reste strict.
--
-- Méthode : corps live lus, normalisés (retours chariot, espaces de fin de
-- ligne), empreinte vérifiée, substitutions comptées, empreinte du résultat
-- vérifiée. Empreintes identiques en dev et en production le 2026-11-14.

DO $mig$
DECLARE
  r          record;
  v_src      text;
  v_new      text;
  v_old      text;
  v_n        int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('_record_sale_stock_v1',         '43b76a7ce2900926f923b7d01a83e32d', '495f5122692079d52214e3fc4e0ab526', '-', 1),
      ('_restore_sale_stock_v1',        '41310d19213458735584136aa426386b', '316bcfef4b8489cea701badcf4ddac62', '+', 0),
      ('_record_cancel_waste_stock_v1', '59341f76b47630d1ee6a87a2107886c9', '9a32de1df053f307b49cad93bec91884', '-', 0)
    ) AS t(fn, src_md5, new_md5, sign, guard_count)
  LOOP
    SELECT regexp_replace(replace(pg_get_functiondef(p.oid), E'\r', ''), '[ \t]+\n', E'\n', 'g')
      INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn;
    IF v_src IS NULL THEN
      RAISE EXCEPTION 's1_11: % not found', r.fn;
    END IF;
    IF md5(v_src) <> r.src_md5 THEN
      RAISE EXCEPTION 's1_11: % live body drifted (md5 %, expected %)', r.fn, md5(v_src), r.src_md5;
    END IF;
    v_new := v_src;

    -- 1. Le compteur ne bouge que pour un produit suivi.
    v_old := 'SET current_stock = current_stock ' || r.sign || E' p_quantity, updated_at = now()\n    WHERE id = p_product_id;';
    v_n := (length(v_new) - length(replace(v_new, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 's1_11: % counter update expects 1 occurrence, found %', r.fn, v_n;
    END IF;
    v_new := replace(v_new, v_old,
      'SET current_stock = current_stock ' || r.sign || E' p_quantity, updated_at = now()\n    WHERE id = p_product_id\n      AND COALESCE(track_inventory, true);');

    -- 2. La garde de solde du stock général ne vise que les produits suivis.
    v_old := 'ELSIF v_track OR v_is_b2b THEN';
    v_n := (length(v_new) - length(replace(v_new, v_old, ''))) / length(v_old);
    IF v_n <> r.guard_count THEN
      RAISE EXCEPTION 's1_11: % guard expects % occurrence(s), found %', r.fn, r.guard_count, v_n;
    END IF;
    v_new := replace(v_new, v_old, 'ELSIF v_track THEN');

    IF md5(v_new) <> r.new_md5 THEN
      RAISE EXCEPTION 's1_11: % result md5 %, expected %', r.fn, md5(v_new), r.new_md5;
    END IF;
    EXECUTE v_new;
  END LOOP;
END
$mig$;
