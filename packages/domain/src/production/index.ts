// packages/domain/src/production/index.ts
// Session 13 — Phase 2.A — Production barrel export.

export * from './types.js';
export {
  unitConversionFactor,
  expandRecipe,
  UnknownUnitConversionError,
} from './recipeExpansion.js';
export { bomCost, checkFeasibility } from './bomResolver.js';
export {
  calculateRecipeCost,
  tryCalculateRecipeCost,
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
  type RecipeGraphProduct,
  type RecipeGraphRow,
  type RecipeCostBreakdown,
  type RecipeCostBreakdownItem,
  type CalculateRecipeCostOptions,
  type TryCalculateRecipeCostResult,
} from './recipeCostCalculator.js';
