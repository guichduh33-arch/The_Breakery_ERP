// apps/backoffice/src/features/inventory-production/hooks/useRecordProduction.ts
//
// Calls `record_production_v1` atomic RPC. Server emits 1 + N stock_movements
// + N+1 journal_entries via the tr_20_je_emit trigger.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type RecordProductionErrorCode =
  | 'forbidden'
  | 'quantity_must_be_positive'
  | 'waste_must_be_non_negative'
  | 'product_not_found'
  | 'section_not_found'
  | 'recipe_not_found'
  | 'insufficient_stock'
  | 'unit_conversion_failed'
  | 'expected_yield_must_be_positive'
  | 'actual_yield_must_be_non_negative'
  | 'variance_reason_too_short'
  | 'unknown';

export class RecordProductionError extends Error {
  /** When the server raises insufficient_stock, the DETAIL field carries a
   *  JSON array of missing items. We surface that via missingDetail. */
  constructor(
    public code: RecordProductionErrorCode,
    message?: string,
    public missingDetail?: unknown,
  ) {
    super(message ?? code);
    this.name = 'RecordProductionError';
  }
}

export interface RecordProductionArgs {
  productId:         string;
  quantityProduced:  number;
  /** UUID de section — REQUIS (CHECK chk_stock_movements_section_required côté DB). */
  sectionId:         string;
  batchNumber?:      string;
  quantityWaste?:    number;
  notes?:            string;
  idempotencyKey:    string;
  /** F5 yield variance: expected qty planned for this batch. */
  expectedYieldQty?: number;
  /** F5 yield variance: realized qty — defaults server-side to quantity_produced. */
  actualYieldQty?:   number;
  /** Required when |variance| > threshold (server-enforced ≥5 chars). */
  yieldVarianceReason?: string;
}

export interface RecordProductionResult {
  production_id: string;
  production_number: string;
  lot_id: string | null;
  movements_count: number;
  je_count: number;
  idempotent_replay: boolean;
}

function classify(message: string): RecordProductionErrorCode {
  if (message.includes('forbidden'))                       return 'forbidden';
  if (message.includes('quantity_must_be_positive'))       return 'quantity_must_be_positive';
  if (message.includes('waste_must_be_non_negative'))      return 'waste_must_be_non_negative';
  if (message.includes('product_not_found'))               return 'product_not_found';
  if (message.includes('section_not_found'))               return 'section_not_found';
  if (message.includes('recipe_not_found'))                return 'recipe_not_found';
  if (message.includes('insufficient_stock'))              return 'insufficient_stock';
  if (message.includes('unit_conversion_failed'))          return 'unit_conversion_failed';
  if (message.includes('expected_yield_must_be_positive')) return 'expected_yield_must_be_positive';
  if (message.includes('actual_yield_must_be_non_negative')) return 'actual_yield_must_be_non_negative';
  if (message.includes('variance_reason_too_short'))       return 'variance_reason_too_short';
  return 'unknown';
}

export function useRecordProduction() {
  const qc = useQueryClient();
  return useMutation<RecordProductionResult, RecordProductionError, RecordProductionArgs>({
    mutationFn: async (args) => {
      // Defense-in-depth: section is required by DB CHECK chk_stock_movements_section_required.
      // The UI enforces this via canSubmit, but guard here to prevent a cryptic 23514.
      if (args.sectionId === '') {
        throw new RecordProductionError('section_not_found', 'section_required');
      }
      const rpcArgs: {
        p_product_id:             string;
        p_quantity_produced:      number;
        p_section_id:             string;
        p_quantity_waste:         number;
        p_idempotency_key:        string;
        p_batch_number?:          string;
        p_notes?:                 string;
        p_expected_yield_qty?:    number;
        p_actual_yield_qty?:      number;
        p_yield_variance_reason?: string;
      } = {
        p_product_id:        args.productId,
        p_quantity_produced: args.quantityProduced,
        p_section_id:        args.sectionId,
        p_quantity_waste:    args.quantityWaste ?? 0,
        p_idempotency_key:   args.idempotencyKey,
      };
      if (args.batchNumber          !== undefined) rpcArgs.p_batch_number          = args.batchNumber;
      if (args.notes                !== undefined) rpcArgs.p_notes                 = args.notes;
      if (args.expectedYieldQty     !== undefined) rpcArgs.p_expected_yield_qty    = args.expectedYieldQty;
      if (args.actualYieldQty       !== undefined) rpcArgs.p_actual_yield_qty      = args.actualYieldQty;
      if (args.yieldVarianceReason  !== undefined) rpcArgs.p_yield_variance_reason = args.yieldVarianceReason;
      const { data, error } = await supabase.rpc('record_production_v1', rpcArgs);
      if (error) {
        const detail = (error as unknown as { details?: string }).details;
        let parsed: unknown;
        if (typeof detail === 'string' && detail.trim().startsWith('[')) {
          try { parsed = JSON.parse(detail); } catch { /* ignore */ }
        }
        throw new RecordProductionError(classify(error.message), error.message, parsed);
      }
      return data as unknown as RecordProductionResult;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inventory-production', 'records'] }),
        qc.invalidateQueries({ queryKey: ['inventory-bo', 'stock-levels'] }),
      ]);
    },
  });
}
