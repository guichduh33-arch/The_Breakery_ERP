// apps/backoffice/src/features/inventory-production/hooks/useRecordBatchProduction.ts
//
// Session 15 / Phase 4.A — Wraps `record_batch_production_v6` atomic RPC.
//
// ADR-008 D6 — un item marqué « ne suit pas le stock » est refusé au bord, le
// DETAIL nomme l'item fautif. ADR-008 D5 — un intermédiaire non déplié restant
// à la profondeur maximale fait échouer le lot entier.
//
// v5 is the single entry point: elle absorbe l'ancien wrapper de date et
// l'implémentation interne, fusionnés par ADR-016. Elle parse l'optionnel
// p_batch.production_date (antidatable) ; quand il est absent le ledger et les
// écritures restent à now() — seule production_records.production_date est
// patchée.
//
// ADR-016 — la cascade s'arrête au premier intermédiaire suivi en stock et le
// consomme depuis son stock. Une pénurie peut donc porter sur un semi-fini.
//
// ADR-008 D4 — le lot BLOQUE en stock insuffisant (le réglage global
// `allow_negative_stock` ne gouverne plus que la vente). `forceNegative` est la
// seule échappatoire, gatée serveur par `inventory.production.force_negative`.
//
// Server contract :
//   p_batch = { notes?, section_id?, idempotency_key?, production_date?,
//               force_negative? }
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
  | 'recipe_depth_exceeded'
  | 'production_requires_deduct_stock'
  | 'insufficient_stock'
  | 'force_negative_forbidden'
  | 'invalid_force_negative'
  | 'invalid_production_date'
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
  /** ISO-8601 timestamp. Backdates production_records.production_date only. */
  productionDate?: string;
  /** ADR-008 D4 — produce despite insufficient stock (permission-gated server-side). */
  forceNegative?: boolean;
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
  /** True when the batch was forced through despite shortages (ADR-008 D4). */
  forced_negative?:    boolean;
  /** Shortages the force bypassed (empty unless forced). */
  shortages?:          { material_name: string; shortfall: number; unit: string }[];
}

function classify(message: string): RecordBatchProductionErrorCode {
  // Doit précéder le test générique : 'force_negative_forbidden' contient 'forbidden'.
  if (message.includes('force_negative_forbidden'))        return 'force_negative_forbidden';
  if (message.includes('invalid_force_negative'))          return 'invalid_force_negative';
  if (message.includes('forbidden'))                       return 'forbidden';
  if (message.includes('invalid_batch_envelope'))          return 'invalid_batch_envelope';
  if (message.includes('items_must_be_non_empty_array'))   return 'items_must_be_non_empty_array';
  if (message.includes('invalid_item_shape'))              return 'invalid_item_shape';
  if (message.includes('item_missing_product_id'))         return 'item_missing_product_id';
  if (message.includes('quantity_must_be_positive'))       return 'quantity_must_be_positive';
  if (message.includes('waste_must_be_non_negative'))      return 'waste_must_be_non_negative';
  if (message.includes('recipe_depth_exceeded'))           return 'recipe_depth_exceeded';
  if (message.includes('production_requires_deduct_stock')) return 'production_requires_deduct_stock';
  if (message.includes('recipe_not_found'))                return 'recipe_not_found';
  if (message.includes('insufficient_stock'))              return 'insufficient_stock';
  if (message.includes('invalid_production_date'))         return 'invalid_production_date';
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
      if (args.productionDate !== undefined && args.productionDate !== '') {
        batchPayload.production_date = args.productionDate;
      }
      // Le serveur exige un booléen JSON strict (invalid_force_negative sinon).
      if (args.forceNegative === true) batchPayload.force_negative = true;

      const itemsPayload = args.items.map(buildItemPayload);

      const { data, error } = await supabase.rpc('record_batch_production_v6', {
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
