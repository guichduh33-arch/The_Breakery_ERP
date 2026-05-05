// packages/domain/src/modifiers/index.ts
export * from './types.js';
export { mergeGroups } from './mergeGroups.js';
export {
  calculatePriceAdjustment,
  calculateLineTotal,
} from './calculatePriceAdjustment.js';
export { validateSelections, type ValidationError } from './validateSelections.js';
