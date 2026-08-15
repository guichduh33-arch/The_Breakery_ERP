// apps/backoffice/src/features/reports/utils/reportFigures.ts
//
// Lot D (campagne Reports 2026-08-15) — les quatre calculs que TOUTE page de
// l'archétype Report refait : variation contre la période précédente, part d'une
// base, comptage localisé, et la coupe « top N » qui totalise le jeu COMPLET.
//
// Ils sont ici parce que le lot D en pose six copies d'un coup. Deux d'entre eux
// portent une règle qui ne doit pas se réinventer page par page :
//
//  · `pctChange` — une comparaison contre une base NULLE n'existe pas. Elle sort
//    `null` (que `Delta` rend en tiret), jamais `Infinity` ni « 0,0% », qui
//    affirmerait que rien n'a bougé.
//  · `topSlice` — une TRONCATURE D'AFFICHAGE NE TRONQUE PAS LE TOTAL. Le total
//    porte le jeu complet, et la note annonce la coupe ; un total calculé sur
//    `.slice(0, N)` ment dès la (N+1)ᵉ ligne.
//
// `DailySalesPage` (lot C) porte ses propres copies : elle est hors du périmètre
// du lot D. Leur convergence est un résiduel du lot F.

/** Lignes visibles par défaut dans une carte de ventilation. */
export const TOP_N = 5;

/** Variation relative en %, ou `null` quand la comparaison n'existe pas. */
export function pctChange(current: number, previous: number | undefined): number | null {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Part en % d'une base — `0` quand la base est nulle (aucune part à montrer). */
export function sharePct(part: number, base: number): number {
  return base > 0 ? (part / base) * 100 : 0;
}

/** Comptage en locale métier (id-ID) — séparateur de milliers « . ». */
export function formatCount(v: number): string {
  return v.toLocaleString('id-ID');
}

/** Pourcentage à une décimale, locale métier. */
export function formatPct1(v: number): string {
  return `${v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export interface TopSlice<T> {
  /** Les `limit` premières lignes — ce qui s'affiche. */
  rows:  T[];
  /** Le total du jeu COMPLET — ce qui est vrai. */
  total: number;
  /** Sous-titre annonçant la coupe, `undefined` quand rien n'est coupé. */
  note:  string | undefined;
}

/**
 * Coupe d'affichage honnête. `all` doit être DÉJÀ trié (l'ordre est un choix
 * métier) ; `unit` nomme le critère dans la note (« by revenue »).
 */
export function topSlice<T>(
  all: T[],
  amount: (t: T) => number,
  unit = 'revenue',
  limit = TOP_N,
): TopSlice<T> {
  return {
    rows:  all.slice(0, limit),
    total: all.reduce((s, t) => s + amount(t), 0),
    note:  all.length > limit
      ? `Top ${limit} of ${formatCount(all.length)} by ${unit}.`
      : undefined,
  };
}

/** « 5 Aug » — date MÉTIER (YYYY-MM-DD) formatée en UTC : un fuseau navigateur
 *  négatif la reculerait d'un jour. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** « Monday 5 August 2026 » — même précaution de fuseau. */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** Libellé de période : une date seule quand start === end, sinon la plage. */
export function periodLabel(start: string, end: string): string {
  return start === end ? longDate(start) : `${shortDate(start)} – ${shortDate(end)}`;
}
