// packages/domain/src/reports/period.ts
//
// S29 Wave 2.2 — previousPeriod : calcule la fenêtre symétrique précédente
// pour le comparison toggle sur reports. Calendar-aware pour mois pleins,
// n-day shift sinon.

function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00Z');
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isFirstOfMonth(d: Date): boolean {
  return d.getUTCDate() === 1;
}

function isLastOfMonth(d: Date): boolean {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.getUTCMonth() !== d.getUTCMonth();
}

export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const startDate = parseDate(start);
  const endDate   = parseDate(end);

  if (isFirstOfMonth(startDate) && isLastOfMonth(endDate)
      && startDate.getUTCFullYear() === endDate.getUTCFullYear()
      && startDate.getUTCMonth() === endDate.getUTCMonth()) {
    const prevMonthStart = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() - 1, 1));
    const prevMonthEnd   = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 0));
    return { start: toIso(prevMonthStart), end: toIso(prevMonthEnd) };
  }

  const dayMs = 86_400_000;
  const lengthDays = Math.round((endDate.getTime() - startDate.getTime()) / dayMs) + 1;
  const prevEnd   = new Date(startDate.getTime() - dayMs);
  const prevStart = new Date(prevEnd.getTime() - (lengthDays - 1) * dayMs);
  return { start: toIso(prevStart), end: toIso(prevEnd) };
}

export interface Delta { abs: number; pct: number | null; sign: 1 | -1 | 0 }

export function formatDelta(current: number, previous: number): Delta {
  const abs = current - previous;
  const sign: 1 | -1 | 0 = abs > 0 ? 1 : abs < 0 ? -1 : 0;
  const pct = previous === 0 ? null : abs / previous;
  return { abs, pct, sign };
}
