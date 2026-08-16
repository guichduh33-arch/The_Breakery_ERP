// apps/backoffice/src/features/reports/hooks/usePurchasePriceTrends.ts
//
// Query hook pour `get_purchase_price_trends_v1` — l'évolution des prix d'achat
// par article (unité de base, moyenne pondérée par la quantité) et la
// concentration fournisseur, période vs fenêtre précédente de même longueur.
//
// Deux choses que la RPC porte et que la page DOIT dire :
//   · tout prix est en UNITÉ DE BASE (`unit_cost ÷ unit_factor_to_base`) —
//     un sac de 25 kg et un kg au détail se comparent enfin ;
//   · `delta_pct` est NULL pour un article sans achat en période précédente
//     (nouveau référencement) — la classification hausse/baisse et l'inflation
//     pondérée sont recalculées CLIENT depuis ces lignes (packages/domain,
//     purchasePrices.ts), jamais re-déclarées ici.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PurchasePriceProductRow {
  product_id:      string;
  name:            string;
  base_unit:       string;
  po_count:        number;
  spend:           number;
  qty_base:        number;
  wavg_price:      number;
  wavg_price_prev: number | null;
  delta_pct:       number | null;
  min_price:       number;
  max_price:       number;
  last_price:      number;
  last_order_date: string;
  last_supplier:   { id: string | null; name: string | null };
}

export interface PurchaseSupplierRow {
  supplier_id: string | null;
  name:        string;
  po_count:    number;
  spend:       number;
  share_pct:   number;
}

export interface PurchasePriceTrendsSummary {
  spend:          number;
  spend_prev:     number;
  po_count:       number;
  product_count:  number;
  supplier_count: number;
}

export interface PurchasePriceTrendsData {
  period:      { start: string; end: string };
  period_prev: { start: string; end: string };
  summary:     PurchasePriceTrendsSummary;
  by_product:  PurchasePriceProductRow[];
  by_supplier: PurchaseSupplierRow[];
}

export interface UsePurchasePriceTrendsParams {
  start:       string;
  end:         string;
  supplierId?: string | null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function toPeriod(v: unknown): { start: string; end: string } {
  const o = (v ?? {}) as Record<string, unknown>;
  return { start: toStr(o.start), end: toStr(o.end) };
}

export function usePurchasePriceTrends(params: UsePurchasePriceTrendsParams) {
  const { start, end, supplierId } = params;
  return useQuery<PurchasePriceTrendsData, Error>({
    queryKey: ['purchase-price-trends', start, end, supplierId ?? null],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      // `exactOptionalPropertyTypes` : on omet l'arg optionnel plutôt que de
      // poser `undefined`.
      const args: { p_start_date: string; p_end_date: string; p_supplier_id?: string } = {
        p_start_date: start,
        p_end_date:   end,
      };
      if (supplierId) args.p_supplier_id = supplierId;

      const { data, error } = await supabase.rpc('get_purchase_price_trends_v1', args);
      if (error) throw error as Error;

      const r        = (data ?? {}) as Record<string, unknown>;
      const summary  = (r.summary ?? {}) as Record<string, unknown>;
      const products = Array.isArray(r.by_product)  ? (r.by_product  as unknown[]) : [];
      const supplierRows = Array.isArray(r.by_supplier) ? (r.by_supplier as unknown[]) : [];

      return {
        period:      toPeriod(r.period),
        period_prev: toPeriod(r.period_prev),
        summary: {
          spend:          toNum(summary.spend),
          spend_prev:     toNum(summary.spend_prev),
          po_count:       toNum(summary.po_count),
          product_count:  toNum(summary.product_count),
          supplier_count: toNum(summary.supplier_count),
        },
        by_product: products.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          const sup = (o.last_supplier ?? {}) as Record<string, unknown>;
          return {
            product_id:      toStr(o.product_id),
            name:            toStr(o.name),
            base_unit:       toStr(o.base_unit),
            po_count:        toNum(o.po_count),
            spend:           toNum(o.spend),
            qty_base:        toNum(o.qty_base),
            wavg_price:      toNum(o.wavg_price),
            wavg_price_prev: toNumOrNull(o.wavg_price_prev),
            delta_pct:       toNumOrNull(o.delta_pct),
            min_price:       toNum(o.min_price),
            max_price:       toNum(o.max_price),
            last_price:      toNum(o.last_price),
            last_order_date: toStr(o.last_order_date),
            last_supplier: {
              id:   sup.id   != null ? toStr(sup.id)   : null,
              name: sup.name != null ? toStr(sup.name) : null,
            },
          };
        }),
        by_supplier: supplierRows.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            supplier_id: o.supplier_id != null ? toStr(o.supplier_id) : null,
            name:        toStr(o.name),
            po_count:    toNum(o.po_count),
            spend:       toNum(o.spend),
            share_pct:   toNum(o.share_pct),
          };
        }),
      } satisfies PurchasePriceTrendsData;
    },
  });
}
