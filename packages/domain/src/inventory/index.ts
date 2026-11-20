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
export {
  movementTypeLabel,
  movementRefPrefix,
  buildMovementRefNo,
  assignRefNos,
  movementOrigin,
  type BuildRefNoInput,
  type LedgerLineForRef,
  type MovementOriginInput,
} from './stockLedgerRef.js';
export { validateAdjust } from './validateAdjust.js';
export { validateReceive } from './validateReceive.js';
export { validateWaste } from './validateWaste.js';
export { computeStockDelta } from './computeStockDelta.js';
export { lowStockFilter, type LowStockCandidate } from './lowStockFilter.js';
export { deriveStockIncrements } from './deriveStockIncrements.js';

// Session 23 — landed cost allocation primitive (mirrors receive_po_v1 SQL).
export {
  calculateLandedCostAllocation,
  type AllocationMethod,
  type PoLineForAllocation,
  type AllocationResult,
} from './landedCostAllocation.js';

// S3-06 — totaux d'un bon avec escomptes et port (miroir de _po_cost_allocation_v1).
export {
  computePurchaseOrderTotals,
  receiptShare,
  splitProRataCents,
  type PoTotalsInput,
  type PoTotalsLineInput,
  type PoTotals,
  type PoLineAllocation,
} from './purchaseOrderTotals.js';
