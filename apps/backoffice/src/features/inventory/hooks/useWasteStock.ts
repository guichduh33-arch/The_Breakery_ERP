// Soumet une perte pour approbation indépendante ; aucun mouvement n’est appliqué ici.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitStockDeclaration, type StockDeclarationResult } from '../stockDeclaration.js';
import { invalidateStockQueries } from '../invalidateStockQueries.js';

export type WasteStockErrorCode =
  | 'idempotency_conflict'
  | 'invalid_quantity'
  | 'forbidden'
  | 'quantity_must_be_positive'
  | 'product_not_found'
  | 'insufficient_stock'
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
  reason:          string;
  idempotencyKey:  string;
}

function classify(message: string): WasteStockErrorCode {
  if (message.includes('idempotency_conflict')) return 'idempotency_conflict';
  if (message.includes('invalid_quantity')) return 'invalid_quantity';
  if (message.includes('forbidden'))                 return 'forbidden';
  if (message.includes('quantity_must_be_positive')) return 'quantity_must_be_positive';
  if (message.includes('insufficient_stock'))        return 'insufficient_stock';
  if (message.includes('product_not_found'))         return 'product_not_found';
  return 'unknown';
}

export function useWasteStock() {
  const qc = useQueryClient();
  return useMutation<StockDeclarationResult, WasteStockError, WasteStockArgs>({
    mutationFn: async ({ productId, quantity, reason, idempotencyKey }) => {
      try { return await submitStockDeclaration('waste', productId, quantity, reason, idempotencyKey); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Declaration failed';
        throw new WasteStockError(classify(message), message);
      }
    },
    onSuccess: () => invalidateStockQueries(qc),
  });
}
