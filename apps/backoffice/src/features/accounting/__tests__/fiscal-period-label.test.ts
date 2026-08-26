// apps/backoffice/src/features/accounting/__tests__/fiscal-period-label.test.ts
//
// Critique design 2026-08-26 — la page des périodes rendait
// `2027-12-01 → 2027-12-31` au moment le plus irréversible de l'app. Un mois
// se NOMME ; et une période qui n'est pas un mois entier ne doit jamais
// recevoir un nom de mois qui ment sur sa couverture.

import { describe, it, expect } from 'vitest';
import { fiscalPeriodLabel } from '../utils/fiscalPeriodLabel.js';

describe('fiscalPeriodLabel', () => {
  it('names a clean calendar month', () => {
    expect(fiscalPeriodLabel('2027-12-01', '2027-12-31')).toBe('December 2027');
    expect(fiscalPeriodLabel('2026-02-01', '2026-02-28')).toBe('February 2026');
  });

  it('handles a leap February', () => {
    expect(fiscalPeriodLabel('2028-02-01', '2028-02-29')).toBe('February 2028');
  });

  it('falls back to two readable dates when the span is not a whole month', () => {
    expect(fiscalPeriodLabel('2026-08-01', '2026-08-15')).toBe('01/08/2026 → 15/08/2026');
    expect(fiscalPeriodLabel('2026-08-02', '2026-08-31')).toBe('02/08/2026 → 31/08/2026');
    // Un 30 dans un mois de 31 jours ne ferme pas le mois.
    expect(fiscalPeriodLabel('2026-12-01', '2026-12-30')).toBe('01/12/2026 → 30/12/2026');
  });
});
