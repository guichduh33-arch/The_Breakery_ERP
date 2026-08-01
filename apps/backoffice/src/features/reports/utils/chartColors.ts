// apps/backoffice/src/features/reports/utils/chartColors.ts
//
// Cost & Spend Analytics — the "two cost families" chart language.
//
//   COGS / material purchasing  → BLUE family   (the backoffice accent)
//   OpEx / operating expenses   → AMBER family
//
// Carried consistently across every cost chart so a reader instantly knows
// which P&L cost bucket a series belongs to. Tuned for the LIGHT backoffice
// theme (ivory cards on a warm neutral); neutrals mirror the design tokens.

/** Headline color for each cost bucket. */
// Audit cohérence 2026-08-01 — les deux familles s'ancrent désormais sur les
// teintes sémantiques du thème (--info et --amber-warn) au lieu du bleu royal
// #1e55d6, qui n'était là que parce qu'il était l'ancien accent Backoffice.
// L'accent, lui, est l'or encre (#8a6820) : il ne porte aucune famille de coût.
export const COGS_BASE = '#2b6c9c'; // --info — famille COGS / achats matière
export const OPEX_BASE = '#8a5a10'; // --amber-warn — famille OpEx

/**
 * Category ramps — family-coherent but mutually distinguishable. Used for
 * donut slices / multi-category bars. Cycles if a series exceeds its length.
 * Retendues pour l'ivoire chaud : plus de bleus saturés clairs, illisibles
 * sur un fond clair.
 */
const COGS_RAMP = [
  '#2b6c9c', '#17456b', '#4f93bf', '#0d5f8a',
  '#6fb0d6', '#1e78a8', '#0a3d5c', '#8cc3e0',
] as const;

const OPEX_RAMP = [
  '#8a5a10', '#a8701c', '#c2872a', '#6b430a',
  '#d9a44a', '#4f3106', '#b06a15', '#e0bd7d',
] as const;

export type CostFamily = 'cogs' | 'opex';

/** Pick the ramp for a family. */
export function familyRamp(family: CostFamily): readonly string[] {
  return family === 'cogs' ? COGS_RAMP : OPEX_RAMP;
}

/** Color for slice `i` within a family (cycles). */
export function familyColor(family: CostFamily, i: number): string {
  const ramp = familyRamp(family);
  return ramp[i % ramp.length]!;
}

/** Base accent for a family. */
export function familyBase(family: CostFamily): string {
  return family === 'cogs' ? COGS_BASE : OPEX_BASE;
}

// --- Categorical series (family-agnostic) -----------------------------------
//
// Multi-series line / pie charts that don't map to a single cost family
// (e.g. per-supplier price trends) draw from one shared, mutually-legible
// hue set instead of ad-hoc per-file hex. Cycles if series exceed length.
export const CATEGORICAL_SERIES = [
  'var(--gold-base)', // accent du thème (or encre en Backoffice)
  '#2b6c9c',          // bleu — COGS_BASE
  '#16a34a',          // green
  '#b4342c',          // red — --red-base du thème clair
  '#0891b2',          // cyan
  '#7c3aed',          // violet
] as const;

/** Color for categorical series `i` (cycles). */
export function categoricalColor(i: number): string {
  return CATEGORICAL_SERIES[i % CATEGORICAL_SERIES.length]!;
}

/** Neutral swatch for an "off / disabled" series (legend toggles). */
export const CHART_SERIES_OFF = '#c3b7a3'; // --border-strong (neutre chaud)

/** Gold accent stroke for a single-series backoffice trend line. */
export const CHART_ACCENT_GOLD = '#8a6820'; // --gold-base du thème clair

// --- Neutrals (light theme) -------------------------------------------------
// Miroirs des tokens `.theme-backoffice` — mis à jour avec l'ivoire chaud de
// l'audit cohérence 2026-08-01 (les anciennes valeurs bleu-gris n'existaient
// plus dans le thème).
export const CHART_GRID_STROKE = '#ebe4d8'; // --border-muted
export const CHART_AXIS_STROKE = '#c3b7a3'; // --border-strong
export const CHART_AXIS_TICK   = '#6d6355'; // --text-muted

/** Shared recharts <Tooltip contentStyle> — ivory card, subtle border. */
export const CHART_TOOLTIP_STYLE = {
  background: '#fffdf9',            // --surface-3
  border: '1px solid #e0d7c8',      // --border-subtle
  borderRadius: 8,
  fontSize: 12,
  color: '#1c1712',                 // --text-primary
  boxShadow: '0 2px 8px rgba(45,34,15,0.09)', // --shadow-md
} as const;

// --- IDR formatters ---------------------------------------------------------

/** Full IDR — "Rp2.364.545". */
export function formatIdrFull(v: number): string {
  return v.toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  });
}

/** Compact IDR for axis ticks / dense labels — "Rp2,4 jt". */
export function formatIdrCompact(v: number): string {
  return v.toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}
