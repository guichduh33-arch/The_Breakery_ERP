// apps/backoffice/src/features/reports/hooks/useStockVariance.ts
//
// Wraps `get_stock_variance_v3(p_date_start, p_date_end)`.
//
// Audit Reports 2026-08-01 lot C / D2 — bump v1 -> v2 : la v1 etait gatee sur
// `inventory.read` alors que sa route exige `reports.inventory.read`. `reports.*`
// gouverne les rapports, `inventory.*` le module operationnel.
//
// ADR-027 — bump v2 -> v3. Le filtre de section disparait (le stock est global)
// et la forme de la ligne change : l'ecran n'affiche plus un ecart theorique
// mais l'IDENTITE COMPTABLE de la fenetre, `closing = opening + stock_in + sold
// + consumed + wasted + corrected + other`. Les mouvements sont SIGNES : sold,
// consumed et wasted sont negatifs ou nuls. Le tri serveur est deja par
// pertinence (|corrected| + |wasted| desc) — on garde l'ordre recu.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface StockVarianceRow {
  product_id:   string;
  product_name: string;
  sku:          string;
  /** Stock reconstitue a la borne basse de la fenetre. */
  opening:      number;
  /** Entrees : achats, receptions, production. Positif. */
  stock_in:     number;
  /** Sorties de vente. Negatif ou nul. */
  sold:         number;
  /** Consommation de production (matiere absorbee). Negatif ou nul. */
  consumed:     number;
  /** Pertes declarees. Negatif ou nul. */
  wasted:       number;
  /** Corrections d'inventaire (`opname_*`, `adjustment*`). Signe. */
  corrected:    number;
  /** Tout le reste du ledger (reservations, transferts d'epoque…). Signe. */
  other:        number;
  /** opening + stock_in + sold + consumed + wasted + corrected + other. */
  closing:      number;
  /** Stock a l'instant present — egal a `closing` sur une fenetre ouverte. */
  current_qty:  number;
}

export interface StockVarianceFilters {
  dateStart?:  string; // ISO timestamp
  dateEnd?:    string;
}

export const STOCK_VARIANCE_QK = ['reports', 'stock-variance'] as const;

export function useStockVariance(filters: StockVarianceFilters = {}) {
  return useQuery<StockVarianceRow[]>({
    queryKey: [...STOCK_VARIANCE_QK, filters] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const args: {
        p_date_start?: string;
        p_date_end?:   string;
      } = {};
      if (filters.dateStart !== undefined && filters.dateStart !== '') {
        args.p_date_start = filters.dateStart;
      }
      if (filters.dateEnd !== undefined && filters.dateEnd !== '') {
        args.p_date_end = filters.dateEnd;
      }
      const { data, error } = await supabase.rpc('get_stock_variance_v3', args);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        product_id:   r.product_id,
        product_name: r.product_name,
        sku:          r.sku,
        opening:      Number(r.opening),
        stock_in:     Number(r.stock_in),
        sold:         Number(r.sold),
        consumed:     Number(r.consumed),
        wasted:       Number(r.wasted),
        corrected:    Number(r.corrected),
        other:        Number(r.other),
        closing:      Number(r.closing),
        current_qty:  Number(r.current_qty),
      }));
    },
  });
}
