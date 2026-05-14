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
  /** Empty string sent to server when no section is chosen — server validates. */
  sectionId:         string;
  batchNumber?:      string;
  quantityWaste?:    number;
  notes?:            string;
  idempotencyKey:    string;
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
  if (message.includes('forbidden'))                  return 'forbidden';
  if (message.includes('quantity_must_be_positive')) return 'quantity_must_be_positive';
  if (message.includes('waste_must_be_non_negative')) return 'waste_must_be_non_negative';
  if (message.includes('product_not_found'))         return 'product_not_found';
  if (message.includes('section_not_found'))         return 'section_not_found';
  if (message.includes('recipe_not_found'))          return 'recipe_not_found';
  if (message.includes('insufficient_stock'))        return 'insufficient_stock';
  if (message.includes('unit_conversion_failed'))    return 'unit_conversion_failed';
  return 'unknown';
}

export function useRecordProduction() {
  const qc = useQueryClient();
  return useMutation<RecordProductionResult, RecordProductionError, RecordProductionArgs>({
    mutationFn: async (args) => {
      const rpcArgs: {
        p_product_id:         string;
        p_quantity_produced:  number;
        p_section_id:         string;
        p_quantity_waste:     number;
        p_idempotency_key:    string;
        p_batch_number?:      string;
        p_notes?:             string;
      } = {
        p_product_id:        args.productId,
        p_quantity_produced: args.quantityProduced,
        p_section_id:        args.sectionId,
        p_quantity_waste:    args.quantityWaste ?? 0,
        p_idempotency_key:   args.idempotencyKey,
      };
      if (args.batchNumber !== undefined) rpcArgs.p_batch_number = args.batchNumber;
      if (args.notes       !== undefined) rpcArgs.p_notes        = args.notes;
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
