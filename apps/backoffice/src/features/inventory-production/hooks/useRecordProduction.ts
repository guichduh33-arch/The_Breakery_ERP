// apps/backoffice/src/features/inventory-production/hooks/useRecordProduction.ts
//
// Calls `record_production_v4` atomic RPC. Server emits 1 + N stock_movements
// + N+1 journal_entries via the tr_20_je_emit trigger.
//
// ADR-008 D6 — produire un article marqué « ne suit pas le stock » est refusé
// (`production_requires_deduct_stock`) : cela créait une entrée valorisée sans
// contrepartie, donc une écriture comptable déséquilibrée.
// ADR-008 D5 — un intermédiaire non déplié restant à la profondeur maximale
// fait échouer la production (`recipe_depth_exceeded`) au lieu de la laisser
// consommer partiellement en silence.
//
// ADR-016 — la cascade s'arrête au premier intermédiaire suivi en stock et le
// consomme depuis son stock. Une pénurie peut donc désormais porter sur un
// semi-fini (« pâte à croissant »), pas seulement sur une matière première.
//
// ADR-008 D4 — la production BLOQUE en stock insuffisant. Le réglage global
// `allow_negative_stock` ne gouverne plus que la vente. `forceNegative` est la
// seule échappatoire : le serveur exige la permission
// `inventory.production.force_negative` (sinon `force_negative_forbidden`).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type RecordProductionErrorCode =
  | 'forbidden'
  | 'quantity_must_be_positive'
  | 'waste_must_be_non_negative'
  | 'product_not_found'
  | 'section_not_found'
  | 'section_required'
  | 'recipe_not_found'
  | 'recipe_depth_exceeded'
  | 'production_requires_deduct_stock'
  | 'insufficient_stock'
  | 'force_negative_forbidden'
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
  /** ADR-008 D4 — produce despite insufficient stock (permission-gated server-side). */
  forceNegative?: boolean;
}

export interface ProductionShortage {
  material_id:   string;
  material_name: string;
  required:      number;
  available:     number;
  shortfall:     number;
  unit:          string;
}

export interface RecordProductionResult {
  production_id: string;
  production_number: string;
  lot_id: string | null;
  movements_count: number;
  je_count: number;
  idempotent_replay: boolean;
  /** True when the production was forced through despite shortages. */
  forced_negative?: boolean;
  /** Shortages the force bypassed (empty unless forced). */
  shortages?: ProductionShortage[];
}

function classify(message: string): RecordProductionErrorCode {
  // Doit précéder le test générique : 'force_negative_forbidden' contient 'forbidden'.
  if (message.includes('force_negative_forbidden'))        return 'force_negative_forbidden';
  if (message.includes('forbidden'))                       return 'forbidden';
  if (message.includes('quantity_must_be_positive'))       return 'quantity_must_be_positive';
  if (message.includes('waste_must_be_non_negative'))      return 'waste_must_be_non_negative';
  if (message.includes('product_not_found'))               return 'product_not_found';
  if (message.includes('section_not_found'))               return 'section_not_found';
  // Doit précéder le test générique : 'recipe_depth_exceeded' ne contient pas
  // 'recipe_not_found', mais l'ordre reste explicite pour la lisibilité.
  if (message.includes('recipe_depth_exceeded'))           return 'recipe_depth_exceeded';
  if (message.includes('production_requires_deduct_stock')) return 'production_requires_deduct_stock';
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
        throw new RecordProductionError('section_required', 'Section is required');
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
        p_force_negative?:        boolean;
      } = {
        p_product_id:        args.productId,
        p_quantity_produced: args.quantityProduced,
        p_section_id:        args.sectionId,
        p_quantity_waste:    args.quantityWaste ?? 0,
        p_idempotency_key:   args.idempotencyKey,
      };
      if (args.forceNegative === true) rpcArgs.p_force_negative = true;
      if (args.batchNumber          !== undefined) rpcArgs.p_batch_number          = args.batchNumber;
      if (args.notes                !== undefined) rpcArgs.p_notes                 = args.notes;
      if (args.expectedYieldQty     !== undefined) rpcArgs.p_expected_yield_qty    = args.expectedYieldQty;
      if (args.actualYieldQty       !== undefined) rpcArgs.p_actual_yield_qty      = args.actualYieldQty;
      if (args.yieldVarianceReason  !== undefined) rpcArgs.p_yield_variance_reason = args.yieldVarianceReason;
      const { data, error } = await supabase.rpc('record_production_v4', rpcArgs);
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
        qc.invalidateQueries({ queryKey: ['stock-levels'] }),
      ]);
    },
  });
}
