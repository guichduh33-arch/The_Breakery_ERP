-- ADR-008 D3 — la raison d'un raté de production devient une catégorie structurée.
--
-- Aujourd'hui la seule information sur un raté est `production_records.notes`, du texte
-- libre : impossible d'en tirer un taux de raté par cause. On crée l'enum Postgres, la
-- colonne dédiée, et la contrainte qui rend la cause obligatoire dès qu'il y a un raté.
--
-- Source unique de l'enum = Postgres (CLAUDE.md) : aucun littéral TS dérivé à la main,
-- le front lit les valeurs depuis les types générés.
--
-- Reprise de données : AUCUNE. Relevé du 2026-07-29 sur V3 dev — 62 `production_records`,
-- dont 0 avec `quantity_waste > 0`. La contrainte est donc satisfaite par l'existant.

CREATE TYPE public.waste_reason AS ENUM (
  'mis_baked',      -- mal cuit
  'poor_proofing',  -- mal levé
  'cosmetic',       -- défaut esthétique
  'demo',           -- démonstration
  'recipe_test',    -- test de recette
  'tasting'         -- dégustation
);

COMMENT ON TYPE public.waste_reason IS
  'ADR-008 D3 : cause d''un raté de production (mal cuit, mal levé, esthétique, démonstration, test recette, dégustation).';

ALTER TABLE public.production_records
  ADD COLUMN waste_reason public.waste_reason;

COMMENT ON COLUMN public.production_records.waste_reason IS
  'ADR-008 D3 : cause du raté. Obligatoire dès que quantity_waste > 0 (contrainte production_records_waste_reason_required).';

ALTER TABLE public.production_records
  ADD CONSTRAINT production_records_waste_reason_required
  CHECK (quantity_waste = 0 OR waste_reason IS NOT NULL);
