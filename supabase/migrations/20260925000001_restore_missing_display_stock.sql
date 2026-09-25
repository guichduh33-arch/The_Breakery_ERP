-- [types-noop] Restaure les lignes de cache supprimées après le backfill initial.
-- Une ligne absente sans mouvement est initialisée à zéro, comme lors du flag.
-- Ne jamais remettre à zéro un compteur existant ni ignorer un historique.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.display_movements dm ON dm.product_id = p.id
    WHERE p.is_display_item
      AND NOT EXISTS (SELECT 1 FROM public.display_stock ds WHERE ds.product_id = p.id)
  ) THEN
    RAISE EXCEPTION 'missing_display_stock_with_history_requires_reconciliation';
  END IF;
END $guard$;

INSERT INTO public.display_stock (product_id, quantity)
SELECT p.id, 0
FROM public.products p
WHERE p.is_display_item
  AND NOT EXISTS (SELECT 1 FROM public.display_stock ds WHERE ds.product_id = p.id)
ON CONFLICT (product_id) DO NOTHING;

