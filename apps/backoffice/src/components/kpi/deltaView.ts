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
  /** Valeur formatée, unité comprise : « 12,4% », « 1,4pt », « >999% », « — ». */
  text: string;
  /**
   * Raison à porter en infobulle ET dans le texte lu, quand la valeur affichée
   * n'est pas la valeur brute. Absent = rien à expliquer.
   */
  hint?: string;
}

const TIRET = '—';

/**
 * Plafond d'affichage d'une variation. Au-delà, le chiffre ne mesure plus une
 * évolution : il dit qu'il n'y avait presque rien à quoi se comparer. « ▲
 * 5.158,2% » se lit alors comme une précision qu'il n'a pas — on plafonne, et
 * la raison part en infobulle (critique design 2026-08-26).
 */
const CAP = 999;

/** Portée en `title` et dans le texte lu quand la variation est plafonnée. */
export const DELTA_CAP_HINT = 'no comparable baseline';

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
  // Le SENS reste porté par la flèche : seule la magnitude est plafonnée.
  if (Math.abs(v) > CAP) {
    return v > 0
      ? { direction: 'up',   glyph: '▲', text: `>${CAP}${suffix}`, hint: DELTA_CAP_HINT }
      : { direction: 'down', glyph: '▼', text: `>${CAP}${suffix}`, hint: DELTA_CAP_HINT };
  }
  if (v > 0)   return { direction: 'up',   glyph: '▲', text: `${fixed1(v)}${suffix}` };
  return { direction: 'down', glyph: '▼', text: `${fixed1(v)}${suffix}` };
}
