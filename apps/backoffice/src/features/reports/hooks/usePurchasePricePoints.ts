// apps/backoffice/src/features/reports/hooks/usePurchasePricePoints.ts
//
// Query hook pour `get_purchase_price_points_v1` — la série de POINTS de prix
// d'un article (un point par ligne de PO, prix en unité de base) qui alimente
// le graphe de tendance du rapport Purchase Price Trends. Même périmètre que
// l'agrégat (`usePurchasePriceTrends`) — le pgTAP T12 tient cette identité.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PurchasePricePoint {
  order_date:    string;
  po_id:         string;
  po_number:     string;
  supplier_id:   string | null;
  supplier_name: string;
  unit_price:    number;
  qty_base:      number;
}

export interface PurchasePricePointsData {
  period:  { start: string; end: string };
  product: { id: string; name: string; base_unit: string };
  points:  PurchasePricePoint[];
}

export interface UsePurchasePricePointsParams {
  productId:   string | null;
  start:       string;
  end:         string;
  supplierId?: string | null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

export function usePurchasePricePoints(params: UsePurchasePricePointsParams) {
  const { productId, start, end, supplierId } = params;
  return useQuery<PurchasePricePointsData, Error>({
    queryKey: ['purchase-price-points', productId, start, end, supplierId ?? null],
    staleTime: 60_000,
    enabled: Boolean(productId && start && end),
    queryFn: async () => {
      const args: {
        p_product_id: string; p_start_date: string; p_end_date: string; p_supplier_id?: string;
      } = {
        // `enabled` garantit productId non nul quand queryFn s'exécute.
        p_product_id: productId!,
        p_start_date: start,
        p_end_date:   end,
      };
      if (supplierId) args.p_supplier_id = supplierId;

      const { data, error } = await supabase.rpc('get_purchase_price_points_v1', args);
      if (error) throw error as Error;

      const r       = (data ?? {}) as Record<string, unknown>;
      const period  = (r.period  ?? {}) as Record<string, unknown>;
      const product = (r.product ?? {}) as Record<string, unknown>;
      const points  = Array.isArray(r.points) ? (r.points as unknown[]) : [];

      return {
        period: { start: toStr(period.start), end: toStr(period.end) },
        product: {
          id:        toStr(product.id),
          name:      toStr(product.name),
          base_unit: toStr(product.base_unit),
        },
        points: points.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            order_date:    toStr(o.order_date),
            po_id:         toStr(o.po_id),
            po_number:     toStr(o.po_number),
            supplier_id:   o.supplier_id != null ? toStr(o.supplier_id) : null,
            supplier_name: toStr(o.supplier_name),
            unit_price:    toNum(o.unit_price),
            qty_base:      toNum(o.qty_base),
          };
        }),
      } satisfies PurchasePricePointsData;
    },
  });
}
