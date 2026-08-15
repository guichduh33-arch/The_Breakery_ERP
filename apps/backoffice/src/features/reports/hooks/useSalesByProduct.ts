// apps/backoffice/src/features/reports/hooks/useSalesByProduct.ts
//
// Query hook pour `get_sales_by_product_v1` — le détail des produits vendus sur
// une fenêtre de jours métier, ventilé comptoir / B2B.
//
// Deux réserves que la RPC porte et que la page DOIT afficher (elles ne se
// devinent pas depuis les nombres) :
//   · `revenue` est un NET de la remise de LIGNE (order_items.line_total l'est
//     déjà) — `discount` dit ce qui a été consenti par-dessus ;
//   · `summary.unattributed` porte la remise de COMMANDE et le total promo, que
//     le schéma ne ventile sur aucune ligne. Ils ne sont donc dans aucun
//     `discount` de produit, et les taire ferait passer la colonne pour le
//     total des remises.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ChannelSplit {
  qty:     number;
  revenue: number;
}

export interface SalesProductRow {
  product_id:    string;
  name:          string;
  category_id:   string | null;
  category_name: string | null;
  qty:           number;
  revenue:       number;
  /** Remise de LIGNE consentie sur ce produit — déjà déduite de `revenue`. */
  discount:      number;
  order_count:   number;
  avg_price:     number;
  share_pct:     number;
  counter:       ChannelSplit;
  b2b:           ChannelSplit;
}

export interface SalesByProductSummary {
  revenue:   number;
  qty:       number;
  discount:  number;
  lines:     number;
  orders:    number;
  products:  number;
  avg_price: number;
  counter:   ChannelSplit;
  b2b:       ChannelSplit;
  /** Remises que le schéma n'attribue à aucun produit. */
  unattributed: {
    order_discount:  number;
    promotion_total: number;
  };
}

export interface SalesByProductData {
  period:     { start: string; end: string };
  summary:    SalesByProductSummary;
  by_product: SalesProductRow[];
}

export interface UseSalesByProductParams {
  start:       string;
  end:         string;
  categoryId?: string | null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function toSplit(v: unknown): ChannelSplit {
  const o = (v ?? {}) as Record<string, unknown>;
  return { qty: toNum(o.qty), revenue: toNum(o.revenue) };
}

export function useSalesByProduct(params: UseSalesByProductParams) {
  const { start, end, categoryId } = params;
  return useQuery<SalesByProductData, Error>({
    queryKey: ['sales-by-product', start, end, categoryId ?? null],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      // `exactOptionalPropertyTypes` : on omet l'arg optionnel plutôt que de
      // poser `undefined`.
      const args: { p_start_date: string; p_end_date: string; p_category_id?: string } = {
        p_start_date: start,
        p_end_date:   end,
      };
      if (categoryId) args.p_category_id = categoryId;

      const { data, error } = await supabase.rpc('get_sales_by_product_v1', args);
      if (error) throw error as Error;

      const r        = (data ?? {}) as Record<string, unknown>;
      const period   = (r.period  ?? {}) as Record<string, unknown>;
      const summary  = (r.summary ?? {}) as Record<string, unknown>;
      const unattrib = (summary.unattributed ?? {}) as Record<string, unknown>;
      const rows     = Array.isArray(r.by_product) ? (r.by_product as unknown[]) : [];

      return {
        period: {
          start: toStr(period.start) || start,
          end:   toStr(period.end)   || end,
        },
        summary: {
          revenue:   toNum(summary.revenue),
          qty:       toNum(summary.qty),
          discount:  toNum(summary.discount),
          lines:     toNum(summary.lines),
          orders:    toNum(summary.orders),
          products:  toNum(summary.products),
          avg_price: toNum(summary.avg_price),
          counter:   toSplit(summary.counter),
          b2b:       toSplit(summary.b2b),
          unattributed: {
            order_discount:  toNum(unattrib.order_discount),
            promotion_total: toNum(unattrib.promotion_total),
          },
        },
        by_product: rows.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            product_id:    toStr(o.product_id),
            name:          toStr(o.name),
            category_id:   o.category_id   != null ? toStr(o.category_id)   : null,
            category_name: o.category_name != null ? toStr(o.category_name) : null,
            qty:           toNum(o.qty),
            revenue:       toNum(o.revenue),
            discount:      toNum(o.discount),
            order_count:   toNum(o.order_count),
            avg_price:     toNum(o.avg_price),
            share_pct:     toNum(o.share_pct),
            counter:       toSplit(o.counter),
            b2b:           toSplit(o.b2b),
          };
        }),
      } satisfies SalesByProductData;
    },
  });
}
