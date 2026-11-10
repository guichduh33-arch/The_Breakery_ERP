// apps/backoffice/src/features/reports/hooks/useProductionVsSales.ts
//
// S3-19 — hook de `get_production_vs_sales_v1` : la production du jour face aux
// ventes reconnues (comptoir et B2B séparés) et aux pertes APPROUVÉES, par
// article, catégorie et jour. Rapport informatif : quantités seules, aucun
// montant, aucune écriture.
//
// La réponse est VALIDÉE ici, pas castée : la RPC promet des clés toujours
// présentes, des tableaux jamais nuls et des nombres numériques. Une réponse qui
// manque à cette promesse lève une erreur lisible (rendue par la bannière du
// socle) au lieu de laisser un `undefined` blanchir la page plus loin.
//
// Les erreurs Postgres sont normalisées pour `ReportShell` : P0003 porte
// `stock_visibility_owner_required` (rapport réservé au propriétaire), 42501
// devient `permission_denied`. Le reste garde le message du serveur.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/** Mesures communes à toutes les granularités. */
export interface ProductionVsSalesFigures {
  produced:     number;
  sold_counter: number;
  sold_b2b:     number;
  sold_total:   number;
  wasted:       number;
  /** produced − sold_total − wasted ; NÉGATIF quand on vend du stock antérieur. */
  gap:          number;
}

export interface ProductionVsSalesSummary extends ProductionVsSalesFigures {
  /** `null` quand rien n'a été produit. */
  sell_through_pct: number | null;
}

export interface PvsCategory {
  id:   string;
  name: string;
  slug: string;
}

export interface PvsDayRow extends ProductionVsSalesFigures {
  date: string;
}

export interface PvsCategoryRow extends ProductionVsSalesSummary {
  category_id:   string;
  category_name: string;
}

export interface PvsProductRow extends ProductionVsSalesSummary {
  product_id:    string;
  product_name:  string;
  category_id:   string;
  category_name: string;
}

export interface PvsDayProductRow extends ProductionVsSalesFigures {
  date:       string;
  product_id: string;
}

export interface ProductionVsSalesData {
  /** Période SERVIE — le début peut être rogné (fenêtre bornée à 92 jours). */
  period:         { start: string; end: string };
  timezone:       string;
  generated_at:   string;
  categories:     PvsCategory[];
  summary:        ProductionVsSalesSummary;
  by_day:         PvsDayRow[];
  by_category:    PvsCategoryRow[];
  by_product:     PvsProductRow[];
  by_day_product: PvsDayProductRow[];
}

export interface UseProductionVsSalesParams {
  start:       string;
  end:         string;
  categoryId?: string | null;
  productId?:  string | null;
}

// --- Validation ---------------------------------------------------------------

/** Erreur de forme : le message nomme le champ fautif. */
function malformed(path: string): Error {
  return new Error(`Unexpected report data from the server (${path}). Please reload; if it persists, report it.`);
}

type Obj = Readonly<Record<string, unknown>>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) throw malformed(path);
  return v;
}

function arr(v: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(v)) throw malformed(path);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw malformed(path);
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw malformed(path);
  return v;
}

function numOrNull(v: unknown, path: string): number | null {
  return v === null ? null : num(v, path);
}

function figures(o: Obj, path: string): ProductionVsSalesFigures {
  return {
    produced:     num(o.produced, `${path}.produced`),
    sold_counter: num(o.sold_counter, `${path}.sold_counter`),
    sold_b2b:     num(o.sold_b2b, `${path}.sold_b2b`),
    sold_total:   num(o.sold_total, `${path}.sold_total`),
    wasted:       num(o.wasted, `${path}.wasted`),
    gap:          num(o.gap, `${path}.gap`),
  };
}

function withSellThrough(o: Obj, path: string): ProductionVsSalesSummary {
  return {
    ...figures(o, path),
    sell_through_pct: numOrNull(o.sell_through_pct, `${path}.sell_through_pct`),
  };
}

/** Lecture validée d'une réponse brute — exportée pour être testée seule. */
export function parseProductionVsSales(raw: unknown): ProductionVsSalesData {
  const r = obj(raw, 'response');
  const period = obj(r.period, 'period');
  return {
    period: {
      start: str(period.start, 'period.start'),
      end:   str(period.end, 'period.end'),
    },
    timezone:     str(r.timezone, 'timezone'),
    generated_at: str(r.generated_at, 'generated_at'),
    categories: arr(r.categories, 'categories').map((c, i) => {
      const o = obj(c, `categories[${i}]`);
      return {
        id:   str(o.id, `categories[${i}].id`),
        name: str(o.name, `categories[${i}].name`),
        slug: str(o.slug, `categories[${i}].slug`),
      };
    }),
    summary: withSellThrough(obj(r.summary, 'summary'), 'summary'),
    by_day: arr(r.by_day, 'by_day').map((d, i) => {
      const o = obj(d, `by_day[${i}]`);
      return { date: str(o.date, `by_day[${i}].date`), ...figures(o, `by_day[${i}]`) };
    }),
    by_category: arr(r.by_category, 'by_category').map((c, i) => {
      const p = `by_category[${i}]`;
      const o = obj(c, p);
      return {
        category_id:   str(o.category_id, `${p}.category_id`),
        category_name: str(o.category_name, `${p}.category_name`),
        ...withSellThrough(o, p),
      };
    }),
    by_product: arr(r.by_product, 'by_product').map((x, i) => {
      const p = `by_product[${i}]`;
      const o = obj(x, p);
      return {
        product_id:    str(o.product_id, `${p}.product_id`),
        product_name:  str(o.product_name, `${p}.product_name`),
        category_id:   str(o.category_id, `${p}.category_id`),
        category_name: str(o.category_name, `${p}.category_name`),
        ...withSellThrough(o, p),
      };
    }),
    by_day_product: arr(r.by_day_product, 'by_day_product').map((x, i) => {
      const p = `by_day_product[${i}]`;
      const o = obj(x, p);
      return {
        date:       str(o.date, `${p}.date`),
        product_id: str(o.product_id, `${p}.product_id`),
        ...figures(o, p),
      };
    }),
  };
}

/** Normalise une erreur PostgREST pour la bannière du socle. */
export function toReportError(error: { code?: string; message?: string }): Error {
  const message = error.message ?? '';
  if (error.code === 'P0003' || message.includes('stock_visibility_owner_required')) {
    return new Error('stock_visibility_owner_required');
  }
  if (error.code === '42501') return new Error('permission_denied');
  return new Error(message !== '' ? message : 'Failed to load report.');
}

export function useProductionVsSales(params: UseProductionVsSalesParams) {
  const { start, end, categoryId, productId } = params;
  return useQuery<ProductionVsSalesData, Error>({
    queryKey: ['production-vs-sales', start, end, categoryId ?? null, productId ?? null],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      // `exactOptionalPropertyTypes` : les args optionnels sont omis, pas `undefined`.
      const args: {
        p_start_date:   string;
        p_end_date:     string;
        p_category_id?: string;
        p_product_id?:  string;
      } = { p_start_date: start, p_end_date: end };
      if (categoryId) args.p_category_id = categoryId;
      if (productId) args.p_product_id = productId;

      const { data, error } = await supabase.rpc('get_production_vs_sales_v1', args);
      if (error) throw toReportError(error);
      return parseProductionVsSales(data);
    },
  });
}
