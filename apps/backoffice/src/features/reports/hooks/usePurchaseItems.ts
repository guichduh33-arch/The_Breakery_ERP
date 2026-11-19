// apps/backoffice/src/features/reports/hooks/usePurchaseItems.ts
//
// S3-20 (2026-11-20) — lecteur de `get_purchase_items_v2` : l'agrégat PAR
// ARTICLE est calculé serveur sur toutes les lignes de la période (la v1
// plafonnait à 1 000 lignes et la page sommait ce plafond), avec la période
// précédente en regard et la dépense par jour. Les lignes d'un article se lisent
// à part, paginées (`usePurchaseItemLines`).
//
// Les quantités sont en unité de BASE de l'article : un même article s'achète
// en sacs et en kilos, et additionner les deux n'avait pas de sens.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

/** Statuts de bon que le serveur accepte en filtre (brouillon et annulé exclus). */
export const PURCHASE_ITEM_STATUSES = ['pending', 'partial', 'received'] as const;
export type PurchaseItemStatus = (typeof PURCHASE_ITEM_STATUSES)[number];

export interface PurchaseItemFilters {
  supplierId?: string | null;
  categoryId?: string | null;
  productId?:  string | null;
  status?:     PurchaseItemStatus | null;
}

export interface PurchaseItemRow {
  product_id:         string;
  product_name:       string;
  sku:                string;
  category_id:        string | null;
  category_name:      string | null;
  /** Unité de base de l'article, celle de `base_quantity`. */
  base_unit:          string | null;
  /** Unité d'achat quand toutes les lignes la partagent ; null si elles varient. */
  purchase_unit:      string | null;
  base_quantity:      number;
  value:              number;
  share_pct:          number;
  /** Valeur ÷ quantité de base ; null sans quantité. */
  avg_unit_cost:      number | null;
  line_count:         number;
  po_count:           number;
  supplier_count:     number;
  last_order_date:    string | null;
  last_received_date: string | null;
  previous_value:     number;
}

export interface PurchaseItemsSummary {
  line_count:           number;
  total_value:          number;
  po_count:             number;
  supplier_count:       number;
  product_count:        number;
  previous_total_value: number;
}

export interface PurchaseTrendPoint {
  date:           string;
  value:          number;
  previous_value: number;
}

export interface PurchaseItemsData {
  period:   { start: string; end: string };
  previous: { start: string; end: string };
  summary:  PurchaseItemsSummary;
  items:    PurchaseItemRow[];
  trend:    PurchaseTrendPoint[];
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Valide l'enveloppe de la RPC : une forme dégradée ne doit pas blanchir la page. */
export function parsePurchaseItems(data: unknown, start: string, end: string): PurchaseItemsData {
  const raw      = asRecord(data);
  const period   = asRecord(raw.period);
  const previous = asRecord(raw.previous);
  const s        = asRecord(raw.summary);
  return {
    period:   { start: toStr(period.start, start), end: toStr(period.end, end) },
    previous: { start: toStr(previous.start), end: toStr(previous.end) },
    summary: {
      line_count:           toNum(s.line_count),
      total_value:          toNum(s.total_value),
      po_count:             toNum(s.po_count),
      supplier_count:       toNum(s.supplier_count),
      product_count:        toNum(s.product_count),
      previous_total_value: toNum(s.previous_total_value),
    },
    items: asArray(raw.items).flatMap((i): PurchaseItemRow[] => {
      const o = asRecord(i);
      const id = toStr(o.product_id);
      if (id === '') return [];
      return [{
        product_id:         id,
        product_name:       toStr(o.product_name, '—'),
        sku:                toStr(o.sku),
        category_id:        strOrNull(o.category_id),
        category_name:      strOrNull(o.category_name),
        base_unit:          strOrNull(o.base_unit),
        purchase_unit:      strOrNull(o.purchase_unit),
        base_quantity:      toNum(o.base_quantity),
        value:              toNum(o.value),
        share_pct:          toNum(o.share_pct),
        avg_unit_cost:      numOrNull(o.avg_unit_cost),
        line_count:         toNum(o.line_count),
        po_count:           toNum(o.po_count),
        supplier_count:     toNum(o.supplier_count),
        last_order_date:    strOrNull(o.last_order_date),
        last_received_date: strOrNull(o.last_received_date),
        previous_value:     toNum(o.previous_value),
      }];
    }),
    trend: asArray(raw.trend).map((t): PurchaseTrendPoint => {
      const o = asRecord(t);
      return { date: toStr(o.date), value: toNum(o.value), previous_value: toNum(o.previous_value) };
    }),
  };
}

export interface UsePurchaseItemsParams extends PurchaseItemFilters {
  start: string;
  end:   string;
}

export function usePurchaseItems(params: UsePurchaseItemsParams) {
  const { start, end, supplierId, categoryId, productId, status } = params;
  return useQuery<PurchaseItemsData, Error>({
    queryKey: ['reports', 'purchase-items', 'v2', start, end,
      supplierId ?? null, categoryId ?? null, productId ?? null, status ?? null],
    queryFn: async () => {
      // `exactOptionalPropertyTypes` : une clé absente tombe sur le DEFAULT NULL.
      const args: {
        p_date_start: string; p_date_end: string;
        p_supplier_id?: string; p_category_id?: string; p_product_id?: string; p_status?: string;
      } = { p_date_start: start, p_date_end: end };
      if (supplierId) args.p_supplier_id = supplierId;
      if (categoryId) args.p_category_id = categoryId;
      if (productId)  args.p_product_id  = productId;
      if (status)     args.p_status      = status;
      const { data, error } = await supabase.rpc('get_purchase_items_v2', args);
      if (error) throw new Error(error.message);
      return parsePurchaseItems(data, start, end);
    },
    enabled: Boolean(start && end),
  });
}

// ---------------------------------------------------------------------------
// Lignes d'un article, paginées.

export interface PurchaseItemLine {
  po_id:             string;
  po_number:         string;
  order_date:        string;
  received_date:     string | null;
  supplier_id:       string;
  supplier_name:     string;
  quantity:          number;
  unit:              string | null;
  received_quantity: number;
  unit_cost:         number;
  subtotal:          number;
  status:            string;
}

export interface PurchaseItemLinesPage {
  total_count: number;
  limit:       number;
  offset:      number;
  lines:       PurchaseItemLine[];
}

export const PURCHASE_LINES_PAGE_SIZE = 50;

export function parsePurchaseItemLines(data: unknown): PurchaseItemLinesPage {
  const raw = asRecord(data);
  return {
    total_count: toNum(raw.total_count),
    limit:       toNum(raw.limit) || PURCHASE_LINES_PAGE_SIZE,
    offset:      toNum(raw.offset),
    lines: asArray(raw.lines).map((l): PurchaseItemLine => {
      const o = asRecord(l);
      return {
        po_id:             toStr(o.po_id),
        po_number:         toStr(o.po_number, '—'),
        order_date:        toStr(o.order_date),
        received_date:     strOrNull(o.received_date),
        supplier_id:       toStr(o.supplier_id),
        supplier_name:     toStr(o.supplier_name, '—'),
        quantity:          toNum(o.quantity),
        unit:              strOrNull(o.unit),
        received_quantity: toNum(o.received_quantity),
        unit_cost:         toNum(o.unit_cost),
        subtotal:          toNum(o.subtotal),
        status:            toStr(o.status),
      };
    }),
  };
}

export interface UsePurchaseItemLinesParams {
  start:      string;
  end:        string;
  /** null = tiroir fermé, aucune requête. */
  productId:  string | null;
  supplierId?: string | null;
  status?:     PurchaseItemStatus | null;
  page:       number;
}

export function usePurchaseItemLines(params: UsePurchaseItemLinesParams) {
  const { start, end, productId, supplierId, status, page } = params;
  return useQuery<PurchaseItemLinesPage, Error>({
    queryKey: ['reports', 'purchase-item-lines', start, end, productId,
      supplierId ?? null, status ?? null, page],
    queryFn: async () => {
      const args: {
        p_date_start: string; p_date_end: string; p_product_id: string;
        p_supplier_id?: string; p_status?: string; p_limit: number; p_offset: number;
      } = {
        p_date_start: start, p_date_end: end, p_product_id: productId ?? '',
        p_limit: PURCHASE_LINES_PAGE_SIZE, p_offset: page * PURCHASE_LINES_PAGE_SIZE,
      };
      if (supplierId) args.p_supplier_id = supplierId;
      if (status)     args.p_status      = status;
      const { data, error } = await supabase.rpc('get_purchase_item_lines_v1', args);
      if (error) throw new Error(error.message);
      return parsePurchaseItemLines(data);
    },
    enabled: Boolean(start && end && productId),
    placeholderData: keepPreviousData,
  });
}
