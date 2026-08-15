// apps/backoffice/src/features/reports/hooks/usePerishableTurnover.ts
//
// Lot J (campagne Reports, 2026-08-15) — branchement de `get_perishable_turnover_v1`,
// livrée en base au S30 et qu'aucune page ne consommait. Front-only : ni la RPC
// ni sa gate (`reports.inventory.read`) ne bougent.
//
// L'enveloppe servie n'a QUE deux clés — `period` et `by_product` : aucun
// agrégat de tête. Les totaux de la page se dérivent donc des lignes, ils ne
// sont pas relus d'un champ serveur qui n'existe pas.
//
// Deux champs sont NULLABLES par construction du corps SQL, et le tiret qu'ils
// méritent n'est pas un zéro :
//
//  · `avg_days_in_stock` — moyenne sur les lots CONSOMMÉS dans la fenêtre. Un
//    produit sans lot consommé sur la période n'a pas « tourné en 0 jour », il
//    n'a pas tourné du tout.
//  · `shelf_life_days_p50` — médiane (expires_at − received_at) sur les lots
//    datés. Un 0 par défaut afficherait « périme le jour même ».
//
// `waste_pct` est servi PAR PRODUIT (0-100, déjà arrondi serveur) : la page ne
// le re-calcule jamais ligne à ligne, et le taux global se recompose des
// quantités — une moyenne de pourcentages donnerait le même poids à un produit
// à 3 lots qu'à un produit à 300.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

/** `../utils/parse.js` n'expose pas de variante nullable — voir l'en-tête :
 *  un jour de stock absent est INCONNU, pas nul. */
function toNumOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface PerishableProductRow {
  product_id:   string;
  product_name: string;
  /** Lots datés du produit, toutes périodes — c'est une profondeur d'historique. */
  lots_count:   number;
  consumed_qty: number;
  expired_qty:  number;
  /** Lots ACTIFS à l'instant de la requête : une photo, pas une fenêtre. */
  current_active_qty: number;
  /** 0-100, servi par la RPC. */
  waste_pct:           number;
  avg_days_in_stock:   number | null;
  shelf_life_days_p50: number | null;
  /** Bucket 1-5 dérivé serveur d'`avg_days_in_stock` (RPC S30). */
  velocity_score:      number;
}

export interface PerishableTurnoverData {
  period:     { start: string; end: string };
  /** Ordre SERVEUR : `consumed_qty` décroissant. */
  by_product: PerishableProductRow[];
}

export interface UsePerishableTurnoverParams {
  start: string;
  end:   string;
}

export function usePerishableTurnover(params: UsePerishableTurnoverParams) {
  return useQuery<PerishableTurnoverData, Error>({
    queryKey: ['reports', 'perishable-turnover', params.start, params.end],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_perishable_turnover_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      const raw    = asRecord(data);
      const period = asRecord(raw.period);
      return {
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        by_product: asArray(raw.by_product).map((r): PerishableProductRow => {
          const o = asRecord(r);
          return {
            product_id:          toStr(o.product_id),
            product_name:        toStr(o.product_name),
            lots_count:          toNum(o.lots_count),
            consumed_qty:        toNum(o.consumed_qty),
            expired_qty:         toNum(o.expired_qty),
            current_active_qty:  toNum(o.current_active_qty),
            waste_pct:           toNum(o.waste_pct),
            avg_days_in_stock:   toNumOrNull(o.avg_days_in_stock),
            shelf_life_days_p50: toNumOrNull(o.shelf_life_days_p50),
            velocity_score:      toNum(o.velocity_score),
          };
        }),
      } satisfies PerishableTurnoverData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
