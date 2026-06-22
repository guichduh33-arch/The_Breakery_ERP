// apps/backoffice/src/features/inventory-production/hooks/useRecordBatchProduction.ts
//
// Session 15 / Phase 4.A — Wraps `record_batch_production_v1` atomic RPC.
//
// Server contract :
//   p_batch = { notes?, section_id?, idempotency_key? }
//   p_items = [{
//     product_id, quantity_produced,
//     quantity_waste?, expected_yield_qty?, actual_yield_qty?,
//     yield_variance_reason?, idempotency_key?
//   }, ...]
//
// On `insufficient_stock`, the DETAIL field carries a JSON array of shortages
// shaped { material_id, material_name, required, available, shortfall, unit }.
// Mirrors useRecordProduction's error surface so the UI can reuse the parser.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type RecordBatchProductionErrorCode =
  | 'forbidden'
  | 'invalid_batch_envelope'
  | 'items_must_be_non_empty_array'
  | 'invalid_item_shape'
  | 'item_missing_product_id'
  | 'quantity_must_be_positive'
  | 'waste_must_be_non_negative'
  | 'recipe_not_found'
  | 'insufficient_stock'
  | 'unknown';

export class RecordBatchProductionError extends Error {
  constructor(
    public code: RecordBatchProductionErrorCode,
    message?: string,
    public missingDetail?: unknown,
  ) {
    super(message ?? code);
    this.name = 'RecordBatchProductionError';
  }
}

export interface BatchItemInput {
  productId:           string;
  quantityProduced:    number;
  quantityWaste?:      number;
  expectedYieldQty?:   number;
  actualYieldQty?:     number;
  yieldVarianceReason?: string;
  idempotencyKey?:     string;
}

export interface RecordBatchProductionArgs {
  sectionId?:      string;
  notes?:          string;
  idempotencyKey:  string;
  items:           BatchItemInput[];
}

export interface BatchProductionRecord {
  production_id:     string;
  production_number: string;
  product_id:        string;
  quantity_produced: number;
  quantity_waste:    number;
  movements_count?:  number;
  lot_id?:           string | null;
}

export interface RecordBatchProductionResult {
  batch_id:            string;
  batch_number:        string;
  status:              'open' | 'completed' | 'cancelled';
  production_records:  BatchProductionRecord[];
  idempotent_replay:   boolean;
}

function classify(message: string): RecordBatchProductionErrorCode {
  if (message.includes('forbidden'))                       return 'forbidden';
  if (message.includes('invalid_batch_envelope'))          return 'invalid_batch_envelope';
  if (message.includes('items_must_be_non_empty_array'))   return 'items_must_be_non_empty_array';
  if (message.includes('invalid_item_shape'))              return 'invalid_item_shape';
  if (message.includes('item_missing_product_id'))         return 'item_missing_product_id';
  if (message.includes('quantity_must_be_positive'))       return 'quantity_must_be_positive';
  if (message.includes('waste_must_be_non_negative'))      return 'waste_must_be_non_negative';
  if (message.includes('recipe_not_found'))                return 'recipe_not_found';
  if (message.includes('insufficient_stock'))              return 'insufficient_stock';
  return 'unknown';
}

function buildItemPayload(item: BatchItemInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    product_id:        item.productId,
    quantity_produced: item.quantityProduced,
  };
  if (item.quantityWaste !== undefined)       out.quantity_waste       = item.quantityWaste;
  if (item.expectedYieldQty !== undefined)    out.expected_yield_qty   = item.expectedYieldQty;
  if (item.actualYieldQty !== undefined)      out.actual_yield_qty     = item.actualYieldQty;
  if (item.yieldVarianceReason !== undefined) out.yield_variance_reason = item.yieldVarianceReason;
  if (item.idempotencyKey !== undefined)      out.idempotency_key      = item.idempotencyKey;
  return out;
}

export function useRecordBatchProduction() {
  const qc = useQueryClient();
  return useMutation<RecordBatchProductionResult, RecordBatchProductionError, RecordBatchProductionArgs>({
    mutationFn: async (args) => {
      const batchPayload: Record<string, unknown> = {
        idempotency_key: args.idempotencyKey,
      };
      if (args.notes !== undefined)     batchPayload.notes      = args.notes;
      if (args.sectionId !== undefined) batchPayload.section_id = args.sectionId;

      const itemsPayload = args.items.map(buildItemPayload);

      const { data, error } = await supabase.rpc('record_batch_production_v1', {
        p_batch: batchPayload as unknown as never,
        p_items: itemsPayload as unknown as never,
      });
      if (error) {
        const detail = (error as unknown as { details?: string }).details;
        let parsed: unknown;
        if (typeof detail === 'string' && detail.trim().startsWith('[')) {
          try { parsed = JSON.parse(detail); } catch { /* ignore */ }
        }
        throw new RecordBatchProductionError(classify(error.message), error.message, parsed);
      }
      return data as unknown as RecordBatchProductionResult;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inventory-production', 'records'] }),
        qc.invalidateQueries({ queryKey: ['inventory-production', 'batches'] }),
        qc.invalidateQueries({ queryKey: ['stock-levels'] }),
      ]);
    },
  });
}
