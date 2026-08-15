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
// Lot F — `DailySalesPage` (lot C) portait ses propres copies de ces helpers ;
// elle consomme désormais celles-ci. Le module n'a plus qu'une définition de
// chacun de ces calculs.

/** Lignes visibles par défaut dans une carte de ventilation. */
export const TOP_N = 5;

/** Noms de mois en clair — la table était recopiée par `PeriodControl` (variante
 *  `month`) et par `Pb1ReportPage`. Elle vit ici avec les autres formatteurs de
 *  date métier du module. Index 0 = janvier. */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Variation relative en %, ou `null` quand la comparaison n'existe pas.
 *
 * Lot F — la garde passe de `previous === 0` à `previous <= 0`. Une variation
 * SIGNÉE contre une base négative est un non-sens : de −100 à −50, le
 * dénominateur en valeur absolue rendait « +50 % », qui se lit comme une
 * croissance alors que la grandeur reste un déficit ; et de −100 à +50, aucun
 * pourcentage ne décrit un changement de signe. Les deux cas sortent désormais
 * `null`, que `Delta` rend en tiret. La comparaison reste lisible en VALEUR,
 * qui elle a un sens sur toute la droite réelle.
 */
export function pctChange(current: number, previous: number | undefined): number | null {
  if (previous === undefined || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
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

/** Garde-fou : une plage libre absurde ne doit pas générer 10 000 points. */
export const MAX_DAYS = 400;

/**
 * Toutes les dates métier de la fenêtre, bornes comprises.
 *
 * Un graphe journalier se lit JOUR PAR JOUR : une journée sans ligne dans le
 * payload doit tout de même occuper sa place, sinon la forme de la semaine est
 * fausse — deux barres voisines à l'écran peuvent être à cinq jours d'écart.
 * C'est l'appelant qui décide ce que vaut un trou : `0` pour un montant (rien
 * n'a été encaissé), `undefined` pour un TAUX (un taux non mesuré n'est pas un
 * taux nul, et la ligne doit s'y interrompre).
 *
 * Lot F — troisième copie de cette boucle dans le module ; elle vit ici.
 */
export function eachDay(start: string, end: string): string[] {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return [];
  const out: string[] = [];
  for (let t = s; t <= e && out.length < MAX_DAYS; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
