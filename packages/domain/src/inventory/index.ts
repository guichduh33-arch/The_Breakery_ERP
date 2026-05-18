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
  // Phase 3 — stock transfers
  TransferStatus,
  TransferItemInput,
  TransferInput,
  TransferReceiveItemInput,
  TransferReceiveInput,
  TransferRpcResult,
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
export {
  validateTransferInput,
  validateTransferReceive,
  type ValidateTransferCode,
  type ValidateTransferReceiveCode,
} from './validateTransfer.js';

// Session 13 — F1 expiry tracking primitives (consumed by POS ProductGrid + BO).
export {
  selectLotForConsumption,
  allLotsExpiredOrConsumed,
  filterExpiringLots,
  type StockLotForFifo,
  type FifoSelectionResult,
} from './expiry/fifo.js';

// Session 13 — Phase 3.C reservation accounting helpers.
export {
  activeHeldQuantity,
  availableQuantity,
  canHoldQuantity,
  type ActiveReservation,
} from './reservations/index.js';

// Session 23 — landed cost allocation primitive (mirrors receive_po_v1 SQL).
export {
  calculateLandedCostAllocation,
  type AllocationMethod,
  type PoLineForAllocation,
  type AllocationResult,
} from './landedCostAllocation.js';
