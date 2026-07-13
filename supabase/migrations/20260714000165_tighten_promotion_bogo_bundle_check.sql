-- S77 (F-3) — chk_promotion_type_fields : trou de sémantique NULL sur les
-- branches à tableaux.
--
-- array_length('{}', 1) renvoie NULL (pas 0) → `NULL >= 1` = NULL → la CHECK
-- entière s'évalue à NULL → PostgreSQL ACCEPTE la ligne. Conséquences live :
--   - un bogo avec bogo_trigger_product_ids = '{}' (ou reward vide) passait ;
--   - un bundle avec bundle_product_ids = '{}' passait (NULL >= 2 = NULL) ;
--   - 24 lignes fantômes « Bad bogo no trigger / no reward » accumulées par
--     promotions-check-constraints.test.ts : le test attendait le rejet, la
--     CHECK laissait passer, et le cleanup (prévu seulement en cas d'échec
--     d'insert) ne tournait jamais — 2 fuites par run.
--
-- Fix : COALESCE(array_length(...), 0) sur les 3 comparaisons de tableaux.
-- Les autres branches (IS NOT NULL) n'ont pas de trou NULL. La branche legacy
-- bogo (bogo_buy_quantity/bogo_get_quantity/bogo_get_product_id) est conservée
-- à l'identique.
--
-- Purge préalable : les 24 lignes de test fuitées (0 référence order_items /
-- promotion_applications, vérifié 2026-07-14) — sinon l'ADD CONSTRAINT échoue
-- à la validation des lignes existantes.

DELETE FROM public.promotions
 WHERE name IN ('Bad bogo no trigger', 'Bad bogo no reward')
   AND type = 'bogo'
   AND (COALESCE(array_length(bogo_trigger_product_ids, 1), 0) < 1
     OR COALESCE(array_length(bogo_reward_product_ids, 1), 0) < 1)
   AND bogo_buy_quantity IS NULL;

ALTER TABLE public.promotions DROP CONSTRAINT chk_promotion_type_fields;

ALTER TABLE public.promotions ADD CONSTRAINT chk_promotion_type_fields CHECK (
  ((type = ANY (ARRAY['percentage'::promotion_type, 'fixed_amount'::promotion_type]))
     AND (discount_value IS NOT NULL) AND (scope IS NOT NULL))
  OR ((type = 'bogo'::promotion_type) AND (
        ((COALESCE(array_length(bogo_trigger_product_ids, 1), 0) >= 1)
           AND (COALESCE(array_length(bogo_reward_product_ids, 1), 0) >= 1)
           AND (bogo_trigger_qty IS NOT NULL)
           AND (bogo_reward_qty IS NOT NULL)
           AND (bogo_reward_discount_pct IS NOT NULL))
        OR ((bogo_buy_quantity IS NOT NULL)
           AND (bogo_get_quantity IS NOT NULL)
           AND (bogo_get_product_id IS NOT NULL))))
  OR ((type = 'free_product'::promotion_type) AND (gift_product_id IS NOT NULL))
  OR ((type = 'threshold'::promotion_type) AND (threshold_amount IS NOT NULL)
     AND (threshold_type IS NOT NULL) AND (discount_value IS NOT NULL))
  OR ((type = 'bundle'::promotion_type) AND (bundle_product_ids IS NOT NULL)
     AND (COALESCE(array_length(bundle_product_ids, 1), 0) >= 2)
     AND (bundle_price IS NOT NULL))
);
