// apps/backoffice/src/features/reports/hooks/useProductSalesLines.ts
//
// Le drill-down de « Sales by Product » : les LIGNES de vente d'un produit,
// paginées au curseur keyset (`get_product_sales_lines_v1`).
//
// `totals` porte le jeu COMPLET, pas la page chargée. La page rendue en tire un
// pied honnête même quand seules cent lignes sur mille sont descendues — un pied
// qui totaliserait les lignes visibles se lirait comme le total du produit.
//
// Le curseur est le token TEXT `"<sold_at>|<id>"` servi par la RPC : la page ne
// le fabrique jamais, elle le repasse tel quel. `enabled` est piloté par la
// présence d'un produit — le tiroir monte fermé.

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/** Canal de vente d'une ligne — le même vocabulaire que la vue agrégée. */
export type SalesLineChannel = 'counter' | 'b2b';

export interface ProductSalesLine {
  id:              string;
  /** Horodatage de la vente (paid_at, repli created_at) — à rendre en WITA. */
  sold_at:         string;
  order_id:        string;
  /** NON UNIQUE : la séquence repart par jour. Toujours l'afficher avec sa date. */
  order_number:    string;
  customer_id:     string | null;
  customer_name:   string | null;
  channel:         SalesLineChannel;
  served_by_name:  string | null;
  /** Nom SOUS LEQUEL le produit a été vendu — peut différer du nom courant. */
  name_snapshot:   string;
  quantity:        number;
  unit_price:      number;
  modifiers_total: number;
  discount_amount: number;
  discount_reason: string | null;
  line_total:      number;
}

export interface ProductSalesLinesTotals {
  lines:       number;
  orders:      number;
  qty:         number;
  revenue:     number;
  discount:    number;
  counter_qty: number;
  b2b_qty:     number;
}

export interface ProductSalesLinesPage {
  lines:       ProductSalesLine[];
  totals:      ProductSalesLinesTotals;
  next_cursor: string | null;
}

export interface UseProductSalesLinesParams {
  productId: string | null;
  start:     string;
  end:       string;
}

export const SALES_LINES_PAGE_SIZE = 100;

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function toNullableStr(v: unknown): string | null {
  return v != null && v !== '' ? toStr(v) : null;
}

export function useProductSalesLines({ productId, start, end }: UseProductSalesLinesParams) {
  return useInfiniteQuery<ProductSalesLinesPage, Error>({
    queryKey: ['product-sales-lines', productId, start, end],
    staleTime: 60_000,
    enabled: productId !== null && Boolean(start && end),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    queryFn: async ({ pageParam }) => {
      const args: {
        p_product_id: string;
        p_start_date: string;
        p_end_date:   string;
        p_limit:      number;
        p_cursor?:    string;
      } = {
        p_product_id: productId ?? '',
        p_start_date: start,
        p_end_date:   end,
        p_limit:      SALES_LINES_PAGE_SIZE,
      };
      if (typeof pageParam === 'string' && pageParam !== '') args.p_cursor = pageParam;

      const { data, error } = await supabase.rpc('get_product_sales_lines_v1', args);
      if (error) throw error as Error;

      const r      = (data ?? {}) as Record<string, unknown>;
      const totals = (r.totals ?? {}) as Record<string, unknown>;
      const rows   = Array.isArray(r.lines) ? (r.lines as unknown[]) : [];

      return {
        lines: rows.map((l) => {
          const o = (l ?? {}) as Record<string, unknown>;
          return {
            id:              toStr(o.id),
            sold_at:         toStr(o.sold_at),
            order_id:        toStr(o.order_id),
            order_number:    toStr(o.order_number),
            customer_id:     toNullableStr(o.customer_id),
            customer_name:   toNullableStr(o.customer_name),
            channel:         o.channel === 'b2b' ? 'b2b' : 'counter',
            served_by_name:  toNullableStr(o.served_by_name),
            name_snapshot:   toStr(o.name_snapshot),
            quantity:        toNum(o.quantity),
            unit_price:      toNum(o.unit_price),
            modifiers_total: toNum(o.modifiers_total),
            discount_amount: toNum(o.discount_amount),
            discount_reason: toNullableStr(o.discount_reason),
            line_total:      toNum(o.line_total),
          };
        }),
        totals: {
          lines:       toNum(totals.lines),
          orders:      toNum(totals.orders),
          qty:         toNum(totals.qty),
          revenue:     toNum(totals.revenue),
          discount:    toNum(totals.discount),
          counter_qty: toNum(totals.counter_qty),
          b2b_qty:     toNum(totals.b2b_qty),
        },
        next_cursor: toNullableStr(r.next_cursor),
      } satisfies ProductSalesLinesPage;
    },
  });
}
