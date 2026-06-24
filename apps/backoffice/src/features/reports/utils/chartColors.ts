// apps/backoffice/src/features/reports/utils/chartColors.ts
//
// Cost & Spend Analytics — the "two cost families" chart language.
//
//   COGS / material purchasing  → BLUE family   (the backoffice accent)
//   OpEx / operating expenses   → AMBER family
//
// Carried consistently across every cost chart so a reader instantly knows
// which P&L cost bucket a series belongs to. Tuned for the LIGHT backoffice
// theme (white cards on cool-gray); neutrals match the design tokens.

/** Headline color for each cost bucket. */
export const COGS_BASE = '#1e55d6'; // royal blue — same as --gold-base in backoffice
export const OPEX_BASE = '#b45309'; // burnt amber

/**
 * Category ramps — family-coherent but mutually distinguishable. Used for
 * donut slices / multi-category bars. Cycles if a series exceeds its length.
 */
const COGS_RAMP = [
  '#1e55d6', '#3b82f6', '#0ea5e9', '#2563eb',
  '#6366f1', '#0284c7', '#60a5fa', '#1a3a8f',
] as const;

const OPEX_RAMP = [
  '#b45309', '#d97706', '#ea580c', '#f59e0b',
  '#a16207', '#92400e', '#e0a44a', '#c2620c',
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

// --- Neutrals (light theme) -------------------------------------------------
export const CHART_GRID_STROKE = '#e2e7ed'; // --border-muted
export const CHART_AXIS_STROKE = '#aeb9c6'; // --border-strong
export const CHART_AXIS_TICK   = '#58646f'; // --text-muted

/** Shared recharts <Tooltip contentStyle> — white card, subtle border. */
export const CHART_TOOLTIP_STYLE = {
  background: '#ffffff',
  border: '1px solid #d3dae3',
  borderRadius: 8,
  fontSize: 12,
  color: '#0e1726',
  boxShadow: '0 4px 12px rgba(14,23,38,0.08)',
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
