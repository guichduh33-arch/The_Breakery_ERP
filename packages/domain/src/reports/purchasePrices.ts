// packages/domain/src/reports/purchasePrices.ts
//
// Constantes et calculs du rapport « Purchase Price Trends » — la CLASSIFICATION
// hausse/baisse et les deux KPI dérivés vivent ICI, pas dans la RPC : une
// constante métier vient du code (jamais déduite des données), et un KPI
// recalculé côté client depuis les lignes affichées ne peut pas diverger de la
// table qu'il surplombe.
//
// IO-free, no React, no Supabase.

/** Seuil (en %) au-delà duquel un prix moyen pondéré est dit « en hausse » ou
 *  « en baisse » — arbitrage Mamat 2026-08-16 (conception du rapport). */
export const PURCHASE_PRICE_RISE_THRESHOLD_PCT = 2;

/** `new` = article sans achat en période précédente : aucun delta n'existe. */
export type PriceTrendClass = 'up' | 'down' | 'flat' | 'new';

export interface PurchasePriceRowLite {
  /** Dépense de la période courante sur l'article. */
  spend:     number;
  /** Variation du prix moyen pondéré vs période précédente, `null` sans base. */
  delta_pct: number | null;
}

export function classifyPriceDelta(
  deltaPct: number | null,
  thresholdPct: number = PURCHASE_PRICE_RISE_THRESHOLD_PCT,
): PriceTrendClass {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return 'new';
  if (deltaPct > thresholdPct)  return 'up';
  if (deltaPct < -thresholdPct) return 'down';
  return 'flat';
}

/**
 * Inflation du panier d'achats, pondérée par la dépense COURANTE :
 * Σ(spend·Δ) ÷ Σ(spend) sur les articles qui ONT une période de comparaison.
 * `null` quand aucun article n'est comparable — un taux non mesurable n'est
 * pas un taux nul.
 */
export function weightedInflationPct(rows: PurchasePriceRowLite[]): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.delta_pct === null || !Number.isFinite(r.delta_pct)) continue;
    const spend = Number(r.spend) || 0;
    if (spend <= 0) continue;
    num += spend * r.delta_pct;
    den += spend;
  }
  return den > 0 ? num / den : null;
}

/**
 * Part (en %) de la dépense courante assise sur des articles classés `up` —
 * la dépense à renégocier en priorité. Le dénominateur est la dépense de TOUTES
 * les lignes (y compris `new`) : c'est la part du panier réel, pas du panier
 * comparable. `null` quand la dépense totale est nulle.
 */
export function risingSpendSharePct(
  rows: PurchasePriceRowLite[],
  thresholdPct: number = PURCHASE_PRICE_RISE_THRESHOLD_PCT,
): number | null {
  let rising = 0;
  let total = 0;
  for (const r of rows) {
    const spend = Number(r.spend) || 0;
    if (spend <= 0) continue;
    total += spend;
    if (classifyPriceDelta(r.delta_pct, thresholdPct) === 'up') rising += spend;
  }
  return total > 0 ? (rising / total) * 100 : null;
}
