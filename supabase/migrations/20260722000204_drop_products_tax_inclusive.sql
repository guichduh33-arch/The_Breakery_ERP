-- ADR-007 décision 4 — DROP de la colonne morte products.tax_inclusive.
--
-- Plus rien ne l'écrit depuis la migration _180 (Lot 6b : retirée des
-- allowlists de create/update_product) et plus rien ne la lit : le mode
-- fiscal est entièrement géré par business_config.tax_inclusive via le
-- helper _pb1_split_v1 (Lot 6a). Vérifié au 2026-07-22 sur le live :
-- les seules occurrences dans pg_proc sont des commentaires (create/
-- update_product_v2), aucune vue ne dépend de la colonne, aucun code app
-- ne la sélectionne. business_config.tax_inclusive n'est PAS concernée.

ALTER TABLE public.products DROP COLUMN tax_inclusive;
