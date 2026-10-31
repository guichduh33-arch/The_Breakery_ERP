// Soumet un comptage absolu pour approbation indépendante ; aucun stock ne change ici.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitStockDeclaration, type StockDeclarationResult } from '../stockDeclaration.js';
import { invalidateStockQueries } from '../invalidateStockQueries.js';

export type AdjustStockErrorCode =
  | 'idempotency_conflict'
  | 'invalid_quantity'
  | 'forbidden'
  | 'negative_qty_not_allowed'
  | 'product_not_found'
  | 'reason_required'
  | 'unknown';

export class AdjustStockError extends Error {
  constructor(public code: AdjustStockErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AdjustStockError';
  }
}

export interface AdjustStockArgs {
  productId:       string;
  newQty:          number;
  reason:          string;
  idempotencyKey:  string;
}

function classify(message: string): AdjustStockErrorCode {
  if (message.includes('idempotency_conflict')) return 'idempotency_conflict';
  if (message.includes('invalid_quantity')) return 'invalid_quantity';
  if (message.includes('forbidden'))                return 'forbidden';
  if (message.includes('negative_qty_not_allowed')) return 'negative_qty_not_allowed';
  if (message.includes('product_not_found'))        return 'product_not_found';
  if (message.includes('reason_required'))          return 'reason_required';
  return 'unknown';
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation<StockDeclarationResult, AdjustStockError, AdjustStockArgs>({
    mutationFn: async ({ productId, newQty, reason, idempotencyKey }) => {
      try { return await submitStockDeclaration('adjust', productId, newQty, reason, idempotencyKey); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Declaration failed';
        throw new AdjustStockError(classify(message), message);
      }
    },
    onSuccess: () => invalidateStockQueries(qc),
  });
}
