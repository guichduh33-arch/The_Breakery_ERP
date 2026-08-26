// apps/backoffice/src/features/accounting/utils/fiscalPeriodLabel.ts
//
// Le nom humain d'une période fiscale. Les périodes sont des mois calendaires
// (seedées par la clôture annuelle), et un mois se NOMME : « December 2027 »,
// pas `2027-12-01 → 2027-12-31` — la page des périodes parlait le dialecte de
// la base au moment le plus irréversible de l'application (critique design
// 2026-08-26). Une période qui ne serait PAS un mois entier (donnée héritée,
// période partielle) retombe sur ses deux bornes formatées : mieux vaut deux
// dates lisibles qu'un nom de mois qui ment sur la couverture.

import { formatDate, formatMonthYearWita } from '@breakery/utils';

/** Vrai si `end` (yyyy-MM-dd) est le dernier jour de son mois. */
function isMonthEnd(end: string): boolean {
  const [y, m, d] = end.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  // Le lendemain en UTC : un 1ᵉʳ = `end` fermait bien le mois. UTC à dessein —
  // l'arithmétique de calendrier n'a pas à traverser un fuseau.
  return new Date(Date.UTC(y, m - 1, d + 1)).getUTCDate() === 1;
}

export function fiscalPeriodLabel(start: string, end: string): string {
  const cleanMonth =
    start.slice(8) === '01' &&
    start.slice(0, 7) === end.slice(0, 7) &&
    isMonthEnd(end);
  return cleanMonth
    ? formatMonthYearWita(start)
    : `${formatDate(start)} → ${formatDate(end)}`;
}
