// packages/domain/src/inventory/index.ts
// Session 12 — inventory MVP barrel.

export type {
  MovementType,
  StockMovementReferenceType,
  StockMovement,
  StockLevel,
  AdjustmentInput,
  ReceiveInput,
  WasteInput,
  StockMovementRpcResult,
} from './types.js';

// `ValidationResult` is re-exported from `payment` at the top-level barrel;
// inventory validators reuse the same discriminated-union shape but the
// concrete type lives inside `./types.ts` for module-local imports only.

export { computeNewStock } from './computeNewStock.js';
export { classifyMovement, type MovementClassification } from './classifyMovement.js';
export { validateAdjust } from './validateAdjust.js';
export { validateReceive } from './validateReceive.js';
export { validateWaste } from './validateWaste.js';
export { computeStockDelta } from './computeStockDelta.js';
export { lowStockFilter, type LowStockCandidate } from './lowStockFilter.js';
