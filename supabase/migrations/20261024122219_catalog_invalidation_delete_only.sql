-- INSERT/UPDATE sont déjà publiés directement. Le signal partagé ne doit pas
-- ajouter un verrou catalogue aux déductions de stock des encaissements.
DROP TRIGGER invalidate_catalog ON public.products;
CREATE TRIGGER invalidate_catalog AFTER DELETE OR TRUNCATE ON public.products
FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('catalog');

DROP TRIGGER invalidate_catalog ON public.categories;
CREATE TRIGGER invalidate_catalog AFTER DELETE OR TRUNCATE ON public.categories
FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('catalog');
