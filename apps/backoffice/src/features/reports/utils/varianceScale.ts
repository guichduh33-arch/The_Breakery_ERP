// apps/backoffice/src/features/reports/utils/varianceScale.ts
//
// Lot B (campagne Reports 2026-08-15) — LE barème de coloration de variance.
// Le module en portait cinq, locaux, non partagés et jamais légendés
// (CashierVariance, ProductionEfficiency, ProductionYield, StockVariance,
// RecipeCost ×2). Un signal de couleur non légendé est un code privé ; ici le
// barème est unique, paramétrable en seuils, et `VarianceLegend` rend la
// légende OBLIGATOIRE à côté de tout usage.
//
// Deux registres, parce que deux sens métier :
//   · `signed` — le signe porte le sens (écart de caisse : manquer est grave,
//     déborder est un autre problème) ;
//   · `abs` — l'amplitude porte le sens (variance de rendement : ±20 % est
//     grave dans les deux directions).

export type VarianceTone = 'good' | 'watch' | 'bad' | 'neutral';

/** Texte seul — cellules de tableau. */
export const VARIANCE_TONE_TEXT: Record<VarianceTone, string> = {
  good:    'text-success',
  watch:   'text-warning',
  bad:     'text-danger font-semibold',
  neutral: 'text-text-secondary',
};

/**
 * Texte seul, POSÉ SUR L'ENCRE — la tuile héro (`KPI_CARD_HERO`, fond #201d19).
 * DESIGN.md, The Ink Semantics Rule : le vert et le rouge du thème sont taillés
 * pour un fond blanc. Mesuré sur l'encre, `--danger` tombe à 2,77:1 — un rouge
 * qu'on ne distingue plus est pire qu'un texte neutre, parce qu'il PRÉTEND
 * signaler. Les équivalents remontés en luminosité tiennent : `--ink-danger`
 * 8,84:1, `--ink-success` 11,95:1.
 *
 * `watch` n'a PAS d'équivalent encre — le thème n'expose aucun `--ink-warning`,
 * et l'ambre du papier vaut 2,84:1 sur l'encre. Il retombe donc sur le neutre :
 * une valeur à surveiller se dit alors par le MOT, jamais par la couleur seule
 * (WCAG 1.4.1, qui vaut de toute façon pour les quatre tons).
 */
export const VARIANCE_TONE_TEXT_INK: Record<VarianceTone, string> = {
  good:    'text-ink-success',
  watch:   'text-ink-fg-sub',
  bad:     'text-ink-danger font-semibold',
  neutral: 'text-ink-fg-sub',
};

/** Fond + texte — cellules de heatmap. Fonds soft du thème, texte sémantique. */
export const VARIANCE_TONE_CELL: Record<VarianceTone, string> = {
  good:    'bg-success-soft text-success',
  watch:   'bg-warning-soft text-warning',
  bad:     'bg-danger-soft text-danger font-semibold',
  neutral: 'text-text-secondary',
};

export interface AbsThresholds {
  /** |v| au-delà duquel on surveille. */
  watch: number;
  /** |v| au-delà duquel c'est un problème. */
  bad: number;
}

/** Amplitude : |v| ≤ watch → good · ≤ bad → watch · au-delà → bad. */
export function varianceToneAbs(
  v: number | null | undefined,
  thresholds: AbsThresholds,
): VarianceTone {
  if (v === null || v === undefined || Number.isNaN(v)) return 'neutral';
  const abs = Math.abs(v);
  if (abs > thresholds.bad)   return 'bad';
  if (abs > thresholds.watch) return 'watch';
  return 'good';
}

export interface SignedThresholds {
  /** En dessous (plus négatif) → bad. */
  bad: number;
  /** En dessous → watch (entre bad et watch : à surveiller). */
  watch?: number;
}

/** Signé : un manquant (négatif) est le signal ; un excédent reste `watch`
 *  léger — trop d'argent dans un tiroir est aussi une anomalie. */
export function varianceToneSigned(
  v: number | null | undefined,
  thresholds: SignedThresholds,
): VarianceTone {
  if (v === null || v === undefined || Number.isNaN(v)) return 'neutral';
  if (v < thresholds.bad) return 'bad';
  if (v < (thresholds.watch ?? 0)) return 'watch';
  if (v === 0) return 'good';
  return v > 0 ? 'watch' : 'good';
}
