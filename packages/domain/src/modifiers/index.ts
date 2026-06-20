// packages/domain/src/modifiers/index.ts
export * from './types.js';
export { mergeGroups } from './mergeGroups.js';
export {
  calculatePriceAdjustment,
  calculateLineTotal,
} from './calculatePriceAdjustment.js';
export { validateSelections, type ValidationError } from './validateSelections.js';
export { parseModifierIngredientsToDeduct } from './parseIngredients.js';
export {
  modifierIngredientLineCost,
  modifierOptionMaterialCost,
  type ModifierCostMaterial,
} from './cost.js';
export {
  foldModifierRowsForEdit,
  validateModifierDraft,
  serializeModifierGroups,
  type ModifierDraftError,
} from './editModel.js';
export type {
  ModifierIngredient,
  EditableModifierOption,
  EditableModifierGroup,
  AdminProductModifierRow,
} from './types.js';
