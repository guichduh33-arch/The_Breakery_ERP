// apps/backoffice/src/features/recipes/index.ts
//
// Session 14 / Phase 4.B — Public surface of the recipes feature.
//
// The legacy recipe data hooks live under `features/inventory-production/`
// (Session 13 — Phase 2.A). This barrel re-exports the new presentation
// components so callers (Product detail "Recipe" tab + the standalone
// `inventory/recipes` page in Wave 4.A) can import from a single, intent-
// revealing path.

export { RecipeBuilder, type RecipeBuilderProps } from './components/RecipeBuilder.js';
