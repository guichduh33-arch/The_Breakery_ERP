// apps/backoffice/src/components/kpi/deltaView.ts
//
// Lot B (campagne Reports 2026-08-15) — extrait de
// features/dashboard/utils/format.ts, où il ne servait qu'au composant Delta,
// désormais partagé entre le dashboard et les rapports. La règle qui traverse
// cette vue : **une donnée absente ne se rend pas en zéro** — un `null` sort en
// tiret cadratin, jamais en « 0,0% » qui affirmerait que rien n'a bougé.

/** Sens d'une variation. `none` = pas de comparaison possible. */
export type DeltaDirection = 'up' | 'down' | 'flat' | 'none';

export interface DeltaView {
  direction: DeltaDirection;
  /** Glyphe seul — rendu `aria-hidden`, la valeur est portée par `text`. */
  glyph: string;
  /** Valeur formatée, unité comprise : « 12,4% », « 1,4pt », « — ». */
  text: string;
}

const TIRET = '—';

function fixed1(v: number): string {
  return Math.abs(v).toLocaleString('id-ID', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Vue d'une variation. `unit` distingue les deux registres :
 *   · `pct` — variation RELATIVE d'une mesure (CA, commandes…).
 *   · `pt`  — écart en POINTS entre deux pourcentages (marge brute). Comparer
 *     deux taux en relatif est le classique du rapport faux, la RPC renvoie
 *     donc déjà des points ; l'unité affichée doit suivre.
 */
export function deltaView(v: number | null | undefined, unit: 'pct' | 'pt' = 'pct'): DeltaView {
  if (v === null || v === undefined || Number.isNaN(v)) {
    return { direction: 'none', glyph: '', text: TIRET };
  }
  const suffix = unit === 'pct' ? '%' : 'pt';
  if (v === 0) return { direction: 'flat', glyph: '=', text: `0,0${suffix}` };
  if (v > 0)   return { direction: 'up',   glyph: '▲', text: `${fixed1(v)}${suffix}` };
  return { direction: 'down', glyph: '▼', text: `${fixed1(v)}${suffix}` };
}
