// apps/backoffice/src/features/customers/customerAnalytics.ts
//
// Agrégats de l'onglet Analytics de la fiche client. Fonction PURE : le hook
// lit les ventes reconnues et leurs lignes, ce module les met en forme.
//
// Refonte du 2026-11-21 (constaté en production) :
// - la courbe partait toujours de « il y a 12 mois » : une boutique ouverte en
//   octobre montrait dix mois vides sur douze. Elle part désormais du PREMIER
//   achat, à la semaine si toutes les semaines tiennent en douze barres ;
// - le total, le panier moyen et le rythme de visite étaient calculés mais
//   jamais montrés ;
// - rien ne disait QUAND le client vient, l'information la plus utile à un café.
//
// Toutes les dates se lisent dans le fuseau métier (Asia/Makassar, ADR-019),
// jamais dans celui du navigateur.

import type { Database } from '@breakery/supabase';

export type AnalyticsOrderType = Database['public']['Enums']['order_type'];

export const BUSINESS_TZ = 'Asia/Makassar';

export interface RecognizedOrderRow {
  id:            string;
  recognized_at: string;
  total:         number | string;
  order_type:    AnalyticsOrderType;
}

export interface OrderItemRow {
  product_id:    string | null;
  name_snapshot: string;
  quantity:      number | string;
  line_total:    number | string;
}

export interface TrendPoint {
  key:    string;
  /** Libellé d'axe : « Oct 26 » au mois, « 3 Nov » à la semaine. */
  label:  string;
  total:  number;
  orders: number;
}

export interface ShareRow<K extends string = string> {
  key:    K;
  label:  string;
  orders: number;
  total:  number;
  /** Part des commandes, 0–100. */
  share:  number;
}

export interface TopProduct {
  product_id: string;
  name:       string;
  quantity:   number;
  spend:      number;
  /** Part de la dépense du client, 0–100. */
  spendShare: number;
}

export interface CustomerAnalytics {
  ordersConsidered: number;
  totalSpend:       number;
  avgBasket:        number;
  firstAt:          string | null;
  lastAt:           string | null;
  /** Jours métier distincts avec au moins une commande. */
  visitDays:        number;
  /** Écart moyen entre deux jours de visite ; null sous deux visites. */
  avgDaysBetween:   number | null;
  daysSinceLast:    number | null;
  granularity:      'week' | 'month';
  /** Vrai quand des mois anciens sortent du graphe (plus de douze mois). */
  trendClipped:     boolean;
  trend:            TrendPoint[];
  byWeekday:        ShareRow[];
  byDaypart:        ShareRow[];
  byType:           ShareRow<AnalyticsOrderType>[];
  topProducts:      TopProduct[];
  /** Nombre de produits distincts achetés (le top n'en montre qu'une partie). */
  distinctProducts: number;
}

const TYPE_ORDER: readonly AnalyticsOrderType[] = ['dine_in', 'take_out', 'delivery', 'b2b'];
const TYPE_LABELS: Record<AnalyticsOrderType, string> = {
  dine_in: 'Dine-in', take_out: 'Take-out', delivery: 'Delivery', b2b: 'B2B',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Moments de la journée d'un café — bornes en heures métier, [début, fin). */
const DAYPARTS: readonly { key: string; label: string; from: number; to: number }[] = [
  { key: 'early',     label: 'Before 9:00',   from: 0,  to: 9 },
  { key: 'morning',   label: '9:00 – 12:00',  from: 9,  to: 12 },
  { key: 'lunch',     label: '12:00 – 15:00', from: 12, to: 15 },
  { key: 'afternoon', label: '15:00 – 18:00', from: 15, to: 18 },
  { key: 'evening',   label: 'After 18:00',   from: 18, to: 24 },
];

export const TOP_PRODUCTS = 8;
const MAX_POINTS = 12;
const DAY_MS = 86_400_000;

interface BizParts { y: number; m: number; d: number; hour: number; weekday: number }

const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', hourCycle: 'h23', weekday: 'short',
});
const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Date, heure et jour de semaine dans le fuseau métier. */
export function bizParts(iso: string | Date): BizParts {
  const parts = PARTS_FMT.formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    y: Number(get('year')), m: Number(get('month')), d: Number(get('day')),
    hour: Number(get('hour')) % 24, weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Jour métier en nombre de jours depuis l'époque — sert aux écarts et aux semaines. */
function dayNumber(p: BizParts): number {
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / DAY_MS);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function buildTrend(
  orders: readonly { parts: BizParts; total: number }[],
  first: BizParts,
  now: BizParts,
): { granularity: 'week' | 'month'; trend: TrendPoint[]; clipped: boolean } {
  const mondayOf = (p: BizParts): number => dayNumber(p) - p.weekday;
  const weeks = (mondayOf(now) - mondayOf(first)) / 7 + 1;
  // À la semaine seulement si TOUTES les semaines tiennent en douze barres :
  // sinon les premières tombaient du graphe (85 à 89 jours = 13 lundis) et la
  // somme des barres ne rejoignait plus le total du bandeau.
  if (weeks <= MAX_POINTS) {
    const points: TrendPoint[] = [];
    for (let w = mondayOf(first); w <= mondayOf(now); w += 7) {
      const date = new Date(w * DAY_MS);
      points.push({ key: `w${w}`, label: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`, total: 0, orders: 0 });
    }
    for (const o of orders) {
      const point = points.find((p) => p.key === `w${mondayOf(o.parts)}`);
      if (point) { point.total += o.total; point.orders += 1; }
    }
    return { granularity: 'week', trend: points, clipped: false };
  }
  const monthIndex = (p: { y: number; m: number }): number => p.y * 12 + (p.m - 1);
  const start = Math.max(monthIndex(first), monthIndex(now) - (MAX_POINTS - 1));
  // Au-delà de douze mois, les plus anciens sortent du graphe : le dire.
  const clipped = start > monthIndex(first);
  const points: TrendPoint[] = [];
  for (let i = start; i <= monthIndex(now); i += 1) {
    const y = Math.floor(i / 12);
    points.push({ key: `m${i}`, label: `${MONTHS[i % 12]} ${String(y).slice(2)}`, total: 0, orders: 0 });
  }
  for (const o of orders) {
    const point = points.find((p) => p.key === `m${monthIndex(o.parts)}`);
    if (point) { point.total += o.total; point.orders += 1; }
  }
  return { granularity: 'month', trend: points, clipped };
}

export function buildCustomerAnalytics(
  rows: readonly RecognizedOrderRow[],
  items: readonly OrderItemRow[],
  now: Date = new Date(),
): CustomerAnalytics {
  const orders = rows
    .map((r) => ({ at: r.recognized_at, parts: bizParts(r.recognized_at), total: Number(r.total), type: r.order_type }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const n = orders.length;
  const totalSpend = orders.reduce((s, o) => s + o.total, 0);

  const first = orders[0];
  const last = orders[n - 1];
  const nowParts = bizParts(now);
  const days = [...new Set(orders.map((o) => dayNumber(o.parts)))].sort((a, b) => a - b);
  const visitDays = days.length;
  const firstDay = days[0];
  const lastDay = days[visitDays - 1];
  const avgDaysBetween = visitDays >= 2 && firstDay !== undefined && lastDay !== undefined
    ? (lastDay - firstDay) / (visitDays - 1) : null;

  // La courbe va jusqu'à « maintenant », ou jusqu'à la dernière vente si
  // l'horloge du poste retarde sur elle : jamais une plage vide.
  const endParts = last !== undefined && dayNumber(last.parts) > dayNumber(nowParts) ? last.parts : nowParts;
  const { granularity, trend, clipped } = first === undefined
    ? { granularity: 'month' as const, trend: [], clipped: false }
    : buildTrend(orders, first.parts, endParts);

  const byWeekday: ShareRow[] = WEEKDAYS.map((label, i) => {
    const hit = orders.filter((o) => o.parts.weekday === i);
    return { key: String(i), label, orders: hit.length, total: hit.reduce((s, o) => s + o.total, 0), share: pct(hit.length, n) };
  });
  const byDaypart: ShareRow[] = DAYPARTS.map((dp) => {
    const hit = orders.filter((o) => o.parts.hour >= dp.from && o.parts.hour < dp.to);
    return { key: dp.key, label: dp.label, orders: hit.length, total: hit.reduce((s, o) => s + o.total, 0), share: pct(hit.length, n) };
  });
  const byType: ShareRow<AnalyticsOrderType>[] = TYPE_ORDER
    .map((key) => {
      const hit = orders.filter((o) => o.type === key);
      return { key, label: TYPE_LABELS[key], orders: hit.length, total: hit.reduce((s, o) => s + o.total, 0), share: pct(hit.length, n) };
    })
    .filter((r) => r.orders > 0);

  const prodAgg = new Map<string, { product_id: string; name: string; quantity: number; spend: number }>();
  for (const it of items) {
    const pid = it.product_id ?? it.name_snapshot;
    const prev = prodAgg.get(pid) ?? { product_id: pid, name: it.name_snapshot, quantity: 0, spend: 0 };
    prev.quantity += Number(it.quantity);
    prev.spend += Number(it.line_total);
    prodAgg.set(pid, prev);
  }
  const itemsSpend = [...prodAgg.values()].reduce((s, p) => s + p.spend, 0);
  const topProducts: TopProduct[] = [...prodAgg.values()]
    .sort((a, b) => b.quantity - a.quantity || b.spend - a.spend)
    .slice(0, TOP_PRODUCTS)
    .map((p) => ({ ...p, spendShare: pct(p.spend, itemsSpend) }));

  return {
    ordersConsidered: n,
    totalSpend,
    avgBasket: n > 0 ? Math.round(totalSpend / n) : 0,
    firstAt: first?.at ?? null,
    lastAt: last?.at ?? null,
    visitDays,
    avgDaysBetween,
    daysSinceLast: lastDay === undefined ? null : Math.max(0, dayNumber(nowParts) - lastDay),
    granularity,
    trendClipped: clipped,
    trend,
    byWeekday,
    byDaypart,
    byType,
    topProducts,
    distinctProducts: prodAgg.size,
  };
}
