// apps/backoffice/src/features/inventory-alerts/hooks/useProductionSuggestions.ts
//
// Lecteur de la famille get_production_suggestions (v5 depuis S3-09 : la
// quantité suggérée est arrondie au pas métier du produit, renvoyé à l'écran).
//
// Extrait de ProductionAlertsTab le 2026-08-08 : l'onglet et le compteur de son
// en-tête lisent la même chose, et une clé de requête écrite à deux endroits
// finit par diverger — react-query servirait alors deux caches pour une seule
// vérité.
//
// La RPC peut ne pas être déployée ; on dégrade vers une liste vide plutôt que
// de faire échouer la page entière pour un onglet. Une réponse mal formée, elle,
// est une erreur : on la valide ici plutôt que de la laisser blanchir l'écran.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductionSuggestion {
  product_id:               string;
  product_sku:              string;
  product_name:             string;
  current_stock:            number;
  avg_daily_sales:          number;
  days_of_stock:            number | null;
  suggested_quantity:       number;
  /** Pas métier du produit (12 = douzaine). null = arrondi entier. */
  production_rounding_step: number | null;
  priority:                 string;
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const PRODUCTION_SUGGESTIONS_KEY = ['production-suggestions'] as const;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Valide une ligne de la RPC ; null si elle ne porte pas l'identité du produit. */
export function parseProductionSuggestion(row: unknown): ProductionSuggestion | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.product_id !== 'string' || typeof r.product_name !== 'string') return null;
  return {
    product_id:               r.product_id,
    product_sku:              typeof r.product_sku === 'string' ? r.product_sku : '',
    product_name:             r.product_name,
    current_stock:            num(r.current_stock) ?? 0,
    avg_daily_sales:          num(r.avg_daily_sales) ?? 0,
    days_of_stock:            num(r.days_of_stock),
    suggested_quantity:       num(r.suggested_quantity) ?? 0,
    production_rounding_step: num(r.production_rounding_step),
    priority:                 typeof r.priority === 'string' ? r.priority : 'low',
  };
}

export function useProductionSuggestions() {
  return useQuery<ProductionSuggestion[]>({
    queryKey: PRODUCTION_SUGGESTIONS_KEY,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
      const { data, error } = await rpc('get_production_suggestions_v5', {});
      if (error !== null) {
        if (/does not exist|undefined function/i.test(error.message)) return [];
        throw new Error(error.message);
      }
      if (data === null || data === undefined) return [];
      if (!Array.isArray(data)) throw new Error('Unexpected production suggestions response.');
      return data
        .map(parseProductionSuggestion)
        .filter((r): r is ProductionSuggestion => r !== null);
    },
  });
}

export interface SetRoundingStepArgs {
  productId: string;
  /** null efface le pas : la suggestion revient à l'arrondi entier. */
  step:      number | null;
}

export function useSetProductionRoundingStep() {
  const qc = useQueryClient();
  return useMutation<void, Error, SetRoundingStepArgs>({
    mutationFn: async ({ productId, step }) => {
      const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
      const { error } = await rpc('set_production_rounding_step_v1', {
        p_product_id: productId,
        p_step:       step,
      });
      if (error !== null) {
        if (error.message.includes('permission_denied')) {
          throw new Error('You are not allowed to change this product.');
        }
        if (error.message.includes('invalid_rounding_step')) {
          throw new Error('The step must be a positive number.');
        }
        throw new Error('Unable to save the production step.');
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PRODUCTION_SUGGESTIONS_KEY });
    },
  });
}
