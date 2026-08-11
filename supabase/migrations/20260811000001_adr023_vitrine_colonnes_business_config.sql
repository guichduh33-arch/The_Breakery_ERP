-- ADR-023 — la vitrine du jour remplace la file de retrait au repos.
-- Lot D « le rendu » : le socle de persistance, rien de plus.
--
-- Deux colonnes sur le socle de réglages existant. Aucune table dédiée : le
-- socle porte DÉJÀ des listes en jsonb (business_hours, enabled_payment_methods,
-- pos_discount_presets, pos_quick_payment_amounts), et la sélection est une
-- liste ordonnée d'ids — pas une entité.
--
--   display_showcase_product_ids  la sélection, ORDONNÉE. Elle ne porte JAMAIS
--                                 un prix (ADR-023 déc. 2) : le prix est résolu
--                                 depuis le catalogue au moment de l'affichage.
--                                 Plafond à 12 = 4 pages de trois, la
--                                 présentation arrêtée par le propriétaire.
--   display_show_ready_orders     l'interrupteur d'ADR-023 déc. 3, ÉTEINT par
--                                 défaut. C'est ce défaut qui porte la décision
--                                 1 ; allumé, il rend à l'écran son
--                                 comportement d'avant, dont le code reste en
--                                 place.
--
-- Aucun bump de RPC ici : l'écran client lit business_config en direct sous son
-- JWT kiosk (RLS auth_read), il ne passe pas par get_settings_by_category. Les
-- deux RPC de réglages partent avec l'écran de curation du back-office, qui est
-- leur seul consommateur.
--
-- Aucune reprise de données (ADR-023 conséquence 7) : la sélection naît vide.

ALTER TABLE public.business_config
  ADD COLUMN IF NOT EXISTS display_showcase_product_ids JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS display_show_ready_orders     BOOLEAN NOT NULL DEFAULT FALSE;

-- Forme de la sélection : un tableau de chaînes, borné. Le format uuid et
-- l'existence des produits ne sont pas contraints ici — un produit peut
-- disparaître du catalogue après coup, et c'est l'affichage qui doit alors le
-- taire (ADR-023 conséquence 5), pas la base qui doit l'empêcher.
ALTER TABLE public.business_config
  DROP CONSTRAINT IF EXISTS business_config_showcase_ids_shape;

ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_showcase_ids_shape CHECK (
    jsonb_typeof(display_showcase_product_ids) = 'array'
    AND jsonb_array_length(display_showcase_product_ids) <= 12
    AND NOT jsonb_path_exists(display_showcase_product_ids, '$[*] ? (@.type() <> "string")')
  );

COMMENT ON COLUMN public.business_config.display_showcase_product_ids IS
  'ADR-023 déc. 2 — sélection ORDONNÉE des produits mis en vitrine sur l''écran client au repos. Ids seuls, jamais de prix : le prix est résolu depuis le catalogue à l''affichage. Max 12 (4 pages de trois).';

COMMENT ON COLUMN public.business_config.display_show_ready_orders IS
  'ADR-023 déc. 3 — interrupteur de la file de retrait sur l''écran client, éteint par défaut. Éteint : la vitrine occupe seule le repos. Allumé : l''écran retrouve son comportement d''avant (file des commandes prêtes + commandes payées). Rallumer est un geste d''exploitation, il ne demande aucun ADR.';
