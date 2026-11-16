// apps/backoffice/src/features/inventory/hooks/useWasteStock.ts
//
// Soumet une déclaration de perte via la famille `submit_stock_declaration`.
// Le stock ne bouge qu'à l'approbation du propriétaire. Le motif vient de la
// liste fermée `waste_reason` (S1-18) ; la note est facultative, sauf pour `other`.
//
// Server-side errors:
//   22023 'waste_reason_required'      — no reason code
//   ''    'reason_required'            — note < 3 chars, or missing with `other`
//   P0003 'forbidden'                  — missing inventory.waste
//   ''    'quantity_must_be_positive'  — quantity <= 0
//   P0002 'product_not_found'          — product deleted
//   P0002 'insufficient_stock'         — quantity > current_stock

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@breakery/supabase';
import { submitStockDeclaration, type StockDeclarationResult } from '../stockDeclaration.js';
import { invalidateStockQueries } from '../invalidateStockQueries.js';

export type WasteStockErrorCode =
  | 'idempotency_conflict'
  | 'invalid_quantity'
  | 'forbidden'
  | 'quantity_must_be_positive'
  | 'product_not_found'
  | 'insufficient_stock'
  | 'waste_reason_required'
  | 'reason_required'
  | 'unknown';

export class WasteStockError extends Error {
  constructor(public code: WasteStockErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'WasteStockError';
  }
}

export interface WasteStockArgs {
  productId:       string;
  quantity:        number;
  wasteReason:     Database['public']['Enums']['waste_reason'];
  /** Note facultative ; exigée (>= 3 caractères) quand le motif est `other`. */
  note?:           string;
  idempotencyKey:  string;
}

function classify(message: string): WasteStockErrorCode {
  if (message.includes('idempotency_conflict')) return 'idempotency_conflict';
  if (message.includes('invalid_quantity')) return 'invalid_quantity';
  if (message.includes('forbidden'))                 return 'forbidden';
  if (message.includes('quantity_must_be_positive')) return 'quantity_must_be_positive';
  if (message.includes('insufficient_stock'))        return 'insufficient_stock';
  if (message.includes('product_not_found'))         return 'product_not_found';
  if (message.includes('waste_reason_required'))     return 'waste_reason_required';
  if (message.includes('reason_required'))           return 'reason_required';
  return 'unknown';
}

export function useWasteStock() {
  const qc = useQueryClient();
  return useMutation<StockDeclarationResult, WasteStockError, WasteStockArgs>({
    mutationFn: async ({ productId, quantity, wasteReason, note, idempotencyKey }) => {
      try { return await submitStockDeclaration('waste', productId, quantity, note?.trim() ?? '', idempotencyKey, wasteReason); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Declaration failed';
        throw new WasteStockError(classify(message), message);
      }
    },
    onSuccess: () => invalidateStockQueries(qc),
  });
}
