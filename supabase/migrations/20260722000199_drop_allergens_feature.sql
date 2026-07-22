-- 20260722000199 — Suppression complète de la feature allergènes (option B).
--
-- Décision Mamat 2026-07-22 (audit module products) : l'option allergènes sort
-- du développement. Supprime la vue résolue, la colonne self-declared (l'index
-- GIN idx_products_allergens_gin tombe avec elle) et l'enum allergen_type.
-- Aucune fonction live ne référence ces objets (vérifié via pg_proc le
-- 2026-07-22) ; update_product_v2 n'a jamais accepté `allergens` dans son
-- allowlist. Le code client (BO AllergensPanel, POS badges, ui AllergenBadge)
-- est retiré dans le même commit.
--
-- Invariant fiche PRODUCTS.md §3.5 : « un champ existe s'il est lu » — plus
-- aucun lecteur après ce commit, donc la colonne meurt (même traitement que
-- prévu pour tax_inclusive, ADR-007 déc. 4).

DROP VIEW IF EXISTS public.view_product_allergens_resolved;

ALTER TABLE public.products DROP COLUMN IF EXISTS allergens;

DROP TYPE IF EXISTS public.allergen_type;
